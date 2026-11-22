<?php

namespace App\Services\Credits;

use App\Exceptions\ApiException;
use App\Models\UsageEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class CreditLedger
{
    public function summary(User $user): array
    {
        $user->loadMissing('plan');
        $used = $this->usedThisMonth($user);

        if ($this->isUnlimited($user)) {
            // Illimité = aucun quota de crédits. La consommation reste enregistrée et les plafonds
            // financiers restent appliqués (voir reserve()).
            return [
                'monthly' => null,
                'used' => $used,
                'remaining' => null,
                'unlimited' => true,
                'analysis_cost' => $this->analysisCost($user),
                'photo_cost' => $this->photoCost($user),
                'spend' => $this->spendSummary($user),
            ];
        }

        $monthly = $this->quota($user);

        return [
            'monthly' => $monthly,
            'used' => $used,
            'remaining' => max(0, $monthly - $used),
            'unlimited' => false,
            'analysis_cost' => $this->analysisCost($user),
            'photo_cost' => $this->photoCost($user),
        ];
    }

    public function isUnlimited(User $user): bool
    {
        return $user->isInternalTestAccount();
    }

    /**
     * Consommation financière estimée (jetons réellement facturés par le fournisseur × tarif configuré).
     *
     * @return array<string, mixed>
     */
    public function spendSummary(User $user): array
    {
        $today = (int) UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfDay())
            ->sum('estimated_cost_micros');
        $month = (int) UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('estimated_cost_micros');
        $analyses = UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->where('status', 'succeeded')
            ->where('operation', 'listing.analyze')
            ->count();

        return [
            'today_usd' => round($today / 1_000_000, 4),
            'month_usd' => round($month / 1_000_000, 4),
            'analyses_month' => $analyses,
            'daily_cap_usd' => (float) config('credits.daily_user_cost_usd'),
            'estimated' => true,
        ];
    }

    public function quota(User $user): int
    {
        $user->loadMissing('plan');
        if ($user->plan && $user->plan->slug !== 'free') {
            return (int) $user->plan->monthly_credits;
        }

        return max(0, (int) config('credits.monthly_credits'));
    }

    public function analysisCost(User $user): int
    {
        $user->loadMissing('plan');
        if ($user->plan && $user->plan->slug !== 'free') {
            return max(1, (int) $user->plan->analysis_cost);
        }

        return max(1, (int) config('credits.analysis_cost'));
    }

    public function photoCost(User $user): int
    {
        return max(1, (int) config('credits.photo_cost'));
    }

    public function usedThisMonth(User $user): int
    {
        return (int) UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('credits_charged');
    }

    /**
     * @param  string  $operation  listing.analyze ou photo.enhance : une seule demande à la fois par type d'opération
     * @param  int|null  $hold  montant provisoire retenu pour les plafonds (par défaut celui d'une analyse)
     */
    public function reserve(User $user, int $cost, string $operation = 'listing.analyze', ?int $hold = null): UsageEvent
    {
        return DB::transaction(function () use ($user, $cost, $operation, $hold) {
            $this->lockGuard();
            User::query()->whereKey($user->id)->lockForUpdate()->first();
            $this->expireStale($user);

            $stats = $this->userStats($user, $operation);
            $inflightLimit = max(1, (int) config('credits.max_inflight'));
            if ($stats['inflight'] >= $inflightLimit) {
                throw $operation === 'listing.analyze'
                    ? new ApiException('analysis_in_progress', 'Une analyse est déjà en cours.', 429)
                    : new ApiException('photo_in_progress', 'Une photo IA est déjà en cours.', 429);
            }

            // Pas de quota pour un compte de test ; tout le reste (une analyse à la fois, plafonds de coût) s'applique.
            if (! $this->isUnlimited($user) && $stats['used_month'] + $cost > $this->quota($user)) {
                throw new ApiException('credits_exhausted', 'Quota mensuel atteint.', 429);
            }

            $hold = $hold ?? max(0, (int) config('credits.reservation_hold_micros'));
            $globalSpent = (int) DB::table('usage_events')
                ->where('created_at', '>=', now()->startOfDay())
                ->sum('estimated_cost_micros');
            $userCap = (int) round(((float) config('credits.daily_user_cost_usd')) * 1_000_000);
            $globalCap = (int) round(((float) config('credits.daily_global_cost_usd')) * 1_000_000);
            // Le compte de test n'a pas de plafond personnel : les essais ne s'arrêtent pas dans la journée.
            $depasseUtilisateur = ! $this->isUnlimited($user) && ($stats['spent_today'] + $hold >= $userCap);
            if ($depasseUtilisateur || $globalSpent + $hold >= $globalCap) {
                throw new ApiException('cost_ceiling', 'Limite de coût quotidienne atteinte.', 429);
            }

            return UsageEvent::query()->create([
                'user_id' => $user->id,
                'operation' => $operation,
                'status' => 'reserved',
                'credits_charged' => $cost,
                'estimated_cost_micros' => $hold,
            ]);
        });
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    public function settle(UsageEvent $event, array $extra): void
    {
        $event->forceFill(array_merge($extra, ['status' => 'succeeded']))->save();
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    public function release(UsageEvent $event, string $status, array $extra = []): void
    {
        if ($event->status !== 'reserved') {
            return;
        }

        $event->forceFill(array_merge($extra, [
            'status' => $status,
            'credits_charged' => 0,
        ]))->save();
    }

    private function lockGuard(): void
    {
        $guard = DB::table('credit_guards')->where('id', 1)->lockForUpdate()->first();
        if ($guard === null) {
            throw new ApiException('credits_unavailable', 'Le contrôle des crédits est indisponible.', 503);
        }
    }

    private function expireStale(User $user): void
    {
        $ttl = max(30, (int) config('credits.reservation_ttl'));
        UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('status', 'reserved')
            ->where('created_at', '<', now()->subSeconds($ttl))
            ->update([
                'status' => 'expired',
                'credits_charged' => 0,
            ]);
    }

    /**
     * @return array{used_month: int, spent_today: int, inflight: int}
     */
    private function userStats(User $user, string $operation): array
    {
        $row = DB::table('usage_events')
            ->where('user_id', $user->id)
            ->selectRaw(
                'COALESCE(SUM(CASE WHEN created_at >= ? THEN credits_charged ELSE 0 END), 0) as used_month',
                [now()->startOfMonth()]
            )
            ->selectRaw(
                'COALESCE(SUM(CASE WHEN created_at >= ? THEN estimated_cost_micros ELSE 0 END), 0) as spent_today',
                [now()->startOfDay()]
            )
            ->selectRaw(
                'COALESCE(SUM(CASE WHEN status = ? AND operation = ? THEN 1 ELSE 0 END), 0) as inflight',
                ['reserved', $operation]
            )
            ->first();

        return [
            'used_month' => (int) ($row->used_month ?? 0),
            'spent_today' => (int) ($row->spent_today ?? 0),
            'inflight' => (int) ($row->inflight ?? 0),
        ];
    }
}
