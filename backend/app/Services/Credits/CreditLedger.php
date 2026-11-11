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
        $monthly = $this->quota($user);
        $used = $this->usedThisMonth($user);

        return [
            'monthly' => $monthly,
            'used' => $used,
            'remaining' => max(0, $monthly - $used),
            'analysis_cost' => $this->analysisCost($user),
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

    public function usedThisMonth(User $user): int
    {
        return (int) UsageEvent::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('credits_charged');
    }

    public function reserve(User $user, int $cost): UsageEvent
    {
        return DB::transaction(function () use ($user, $cost) {
            $this->lockGuard();
            User::query()->whereKey($user->id)->lockForUpdate()->first();
            $this->expireStale($user);

            $stats = $this->userStats($user);
            $inflightLimit = max(1, (int) config('credits.max_inflight'));
            if ($stats['inflight'] >= $inflightLimit) {
                throw new ApiException('analysis_in_progress', 'Une analyse est déjà en cours.', 429);
            }

            if ($stats['used_month'] + $cost > $this->quota($user)) {
                throw new ApiException('credits_exhausted', 'Quota mensuel atteint.', 429);
            }

            $hold = max(0, (int) config('credits.reservation_hold_micros'));
            $globalSpent = (int) DB::table('usage_events')
                ->where('created_at', '>=', now()->startOfDay())
                ->sum('estimated_cost_micros');
            $userCap = (int) round(((float) config('credits.daily_user_cost_usd')) * 1_000_000);
            $globalCap = (int) round(((float) config('credits.daily_global_cost_usd')) * 1_000_000);
            if ($stats['spent_today'] + $hold >= $userCap || $globalSpent + $hold >= $globalCap) {
                throw new ApiException('cost_ceiling', 'Limite de coût quotidienne atteinte.', 429);
            }

            return UsageEvent::query()->create([
                'user_id' => $user->id,
                'operation' => 'listing.analyze',
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
    private function userStats(User $user): array
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
                'COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) as inflight',
                ['reserved']
            )
            ->first();

        return [
            'used_month' => (int) ($row->used_month ?? 0),
            'spent_today' => (int) ($row->spent_today ?? 0),
            'inflight' => (int) ($row->inflight ?? 0),
        ];
    }
}
