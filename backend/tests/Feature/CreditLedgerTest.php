<?php

namespace Tests\Feature;

use App\Exceptions\ApiException;
use App\Models\Plan;
use App\Models\UsageEvent;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CreditLedgerTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_one_analysis_can_be_reserved_at_a_time(): void
    {
        config([
            'credits.monthly_credits' => 5,
            'credits.max_inflight' => 1,
            'credits.daily_user_cost_usd' => 10,
            'credits.daily_global_cost_usd' => 25,
        ]);
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);
        $ledger = app(CreditLedger::class);

        $ledger->reserve($user, 1);

        try {
            $ledger->reserve($user, 1);
            $this->fail('Une seconde réservation a été acceptée.');
        } catch (ApiException $e) {
            $this->assertSame('analysis_in_progress', $e->errorCode);
        }

        $this->assertSame(1, UsageEvent::query()->where('status', 'reserved')->count());
    }

    public function test_a_stale_reservation_is_released_before_the_next_one(): void
    {
        config([
            'credits.monthly_credits' => 5,
            'credits.max_inflight' => 1,
            'credits.reservation_ttl' => 180,
            'credits.daily_user_cost_usd' => 10,
            'credits.daily_global_cost_usd' => 25,
        ]);
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);
        $ledger = app(CreditLedger::class);
        $first = $ledger->reserve($user, 1);

        $this->travel(4)->minutes();
        $second = $ledger->reserve($user, 1);

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame(0, $first->fresh()->credits_charged);
        $this->assertSame('reserved', $second->status);
        $this->assertSame(1, $ledger->usedThisMonth($user));
    }

    public function test_the_hold_stops_a_second_account_before_the_budget_is_crossed(): void
    {
        config([
            'credits.monthly_credits' => 5,
            'credits.max_inflight' => 5,
            'credits.reservation_hold_micros' => 20000,
            'credits.daily_user_cost_usd' => 10,
            'credits.daily_global_cost_usd' => 0.03,
        ]);
        $ledger = app(CreditLedger::class);
        $first = User::factory()->create(['plan_id' => Plan::free()->id]);
        $second = User::factory()->create(['plan_id' => Plan::free()->id]);

        $ledger->reserve($first, 1);

        try {
            $ledger->reserve($second, 1);
            $this->fail('Le second compte a dépassé le plafond.');
        } catch (ApiException $e) {
            $this->assertSame('cost_ceiling', $e->errorCode);
        }

        $this->assertSame(1, UsageEvent::query()->count());
    }
}
