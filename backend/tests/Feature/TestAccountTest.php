<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\UsageEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\Support\Jpeg;
use Tests\TestCase;

/**
 * Compte de test interne : accès service fermé et absence de quota, uniquement pour lui,
 * avec double verrou (liste du serveur + drapeau en base). Le plafond du jour ne le concerne pas.
 */
class TestAccountTest extends TestCase
{
    use RefreshDatabase;

    private const EMAIL = 'essai-chrome@annoncefutee.fr';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'openai.api_key' => 'sk-test-not-real',
            'openai.model' => 'gpt-config-check',
            'openai.base_url' => 'https://api.openai.com/v1',
            'openai.input_cost_per_million' => 0.20,
            'openai.output_cost_per_million' => 1.20,
            'credits.monthly_credits' => 1,
            'credits.analysis_cost' => 1,
            'credits.per_minute' => 60,
            'credits.daily_user_cost_usd' => 1,
            'credits.daily_global_cost_usd' => 25,
            'access.registration' => false,
            'access.client_api' => false,
            'access.test_account_emails' => [self::EMAIL],
        ]);
    }

    public function test_the_test_account_can_log_in_while_the_service_is_closed(): void
    {
        $this->testAccount();

        $reponse = $this->postJson('/api/v1/auth/login', ['email' => self::EMAIL, 'password' => 'secret-test-1', 'device_name' => 'chrome'])
            ->assertOk()
            ->assertJsonPath('user.test_account', true)
            ->assertJsonPath('credits.unlimited', true)
            ->assertJsonPath('credits.remaining', null)
            ->assertJsonPath('credits.monthly', null);
        $this->assertIsString($reponse->json('token'));

        $this->withToken($reponse->json('token'))->getJson('/api/v1/me')->assertOk()
            ->assertJsonPath('credits.unlimited', true);
    }

    public function test_every_other_account_stays_blocked_even_with_the_right_password(): void
    {
        $autre = User::factory()->create(['email' => 'camille@example.com', 'password' => 'motdepasse1', 'plan_id' => Plan::free()->id]);
        $this->assertFalse($autre->isInternalTestAccount());

        $this->postJson('/api/v1/auth/login', ['email' => 'camille@example.com', 'password' => 'motdepasse1'])
            ->assertForbidden()->assertJsonPath('code', 'client_access_closed');
        $this->postJson('/api/v1/auth/login', ['email' => 'inconnu@example.com', 'password' => 'x'])
            ->assertForbidden()->assertJsonPath('code', 'client_access_closed');

        // Un jeton déjà émis pour un autre compte ne passe pas non plus.
        $this->withToken($autre->createToken('t')->plainTextToken)->getJson('/api/v1/me')
            ->assertForbidden()->assertJsonPath('code', 'client_access_closed');
        Http::fake();
        $this->withToken($autre->createToken('t')->plainTextToken)
            ->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_the_two_locks_are_both_required(): void
    {
        // Drapeau en base sans adresse listée : aucun droit.
        $sansListe = User::factory()->create(['email' => 'pirate@example.com', 'password' => 'motdepasse1', 'plan_id' => Plan::free()->id]);
        $sansListe->forceFill(['internal_test_account' => true])->save();
        $this->postJson('/api/v1/auth/login', ['email' => 'pirate@example.com', 'password' => 'motdepasse1'])->assertForbidden();

        // Adresse listée sans drapeau : mot de passe exact refusé, aucun jeton.
        User::factory()->create(['email' => self::EMAIL, 'password' => 'secret-test-1', 'plan_id' => Plan::free()->id]);
        $this->postJson('/api/v1/auth/login', ['email' => self::EMAIL, 'password' => 'secret-test-1'])
            ->assertForbidden()->assertJsonPath('code', 'client_access_closed');
        $this->assertDatabaseCount('personal_access_tokens', 0);

        // Mauvais mot de passe du compte de test : refus normal, sans indice sur le drapeau.
        $this->postJson('/api/v1/auth/login', ['email' => self::EMAIL, 'password' => 'faux'])->assertUnprocessable();
    }

    public function test_the_flag_is_not_mass_assignable_nor_set_by_registration(): void
    {
        config(['access.registration' => true, 'access.client_api' => true]);

        $this->postJson('/api/v1/auth/register', [
            'name' => 'Pirate', 'email' => self::EMAIL, 'password' => 'motdepasse1',
            'password_confirmation' => 'motdepasse1', 'internal_test_account' => true,
        ])->assertCreated()->assertJsonPath('user.test_account', false);

        $this->assertFalse((bool) User::query()->where('email', self::EMAIL)->value('internal_test_account'));
        $this->assertNotContains('internal_test_account', (new User)->getFillable());
    }

    public function test_the_test_account_has_no_credit_quota_but_every_record_is_kept(): void
    {
        Http::fake([
            'https://api.openai.com/*' => Http::response($this->openaiBody(), 200),
        ]);
        $token = $this->tokenOf($this->testAccount());

        foreach ([1, 2, 3] as $i) {
            $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
                ->assertOk()
                ->assertJsonPath('credits.unlimited', true)
                ->assertJsonPath('credits.used', $i)
                ->assertJsonPath('credits.remaining', null);
        }

        // Historique et consommation réelle conservés (3 analyses > quota gratuit de 1).
        $this->assertSame(3, UsageEvent::query()->where('status', 'succeeded')->count());
        $this->assertSame(3, (int) UsageEvent::query()->sum('credits_charged'));
        $this->withToken($token)->getJson('/api/v1/me')
            ->assertJsonPath('credits.spend.analyses_month', 3)
            ->assertJsonPath('credits.spend.estimated', true)
            ->assertJsonPath('credits.spend.today_usd', 0.0013)
            ->assertJsonPath('credits.spend.daily_cap_usd', 1);
    }

    public function test_a_normal_account_keeps_its_quota_when_the_service_is_open(): void
    {
        config(['access.client_api' => true]);
        Http::fake(['https://api.openai.com/*' => Http::response($this->openaiBody(), 200)]);
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);
        $token = $user->createToken('t')->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertOk()->assertJsonPath('credits.unlimited', false)->assertJsonPath('credits.remaining', 0);
        $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertStatus(429)->assertJsonPath('code', 'credits_exhausted');
        Http::assertSentCount(1);
    }

    public function test_the_personal_daily_ceiling_does_not_stop_the_test_account(): void
    {
        config(['credits.daily_user_cost_usd' => 0.000001]);
        $user = $this->testAccount();
        UsageEvent::query()->create([
            'user_id' => $user->id, 'operation' => 'listing.analyze', 'status' => 'succeeded',
            'credits_charged' => 1, 'estimated_cost_micros' => 5,
        ]);
        Http::fake(['https://api.openai.com/*' => Http::response($this->openaiBody(), 200)]);

        $this->withToken($this->tokenOf($user))->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertOk();
    }

    public function test_the_global_daily_ceiling_still_stops_the_test_account(): void
    {
        config(['credits.daily_global_cost_usd' => 0.000001]);
        $user = $this->testAccount();
        UsageEvent::query()->create([
            'user_id' => $user->id, 'operation' => 'listing.analyze', 'status' => 'succeeded',
            'credits_charged' => 1, 'estimated_cost_micros' => 5,
        ]);
        Http::fake();

        $this->withToken($this->tokenOf($user))->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertStatus(429)->assertJsonPath('code', 'cost_ceiling');
        Http::assertNothingSent();
    }

    public function test_a_second_concurrent_analysis_is_still_refused_for_the_test_account(): void
    {
        $user = $this->testAccount();
        UsageEvent::query()->create([
            'user_id' => $user->id, 'operation' => 'listing.analyze', 'status' => 'reserved',
            'credits_charged' => 1, 'estimated_cost_micros' => 1000,
        ]);
        Http::fake();

        $this->withToken($this->tokenOf($user))->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])
            ->assertStatus(429)->assertJsonPath('code', 'analysis_in_progress');
        Http::assertNothingSent();
    }

    public function test_the_per_minute_throttle_still_applies(): void
    {
        config(['credits.per_minute' => 1]);
        Http::fake(['https://api.openai.com/*' => Http::response($this->openaiBody(), 200)]);
        $token = $this->tokenOf($this->testAccount());

        $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])->assertOk();
        $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => [Jpeg::make()]])->assertStatus(429);
        Http::assertSentCount(1);
    }

    public function test_logout_works_for_the_test_account_while_closed(): void
    {
        $token = $this->tokenOf($this->testAccount());
        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_health_exposes_only_booleans_and_never_the_addresses(): void
    {
        $this->getJson('/api/v1/health')->assertOk()
            ->assertJsonPath('client_api', false)
            ->assertJsonPath('test_account_access', true)
            ->assertDontSee('essai-chrome')
            ->assertDontSee('sk-test-not-real');

        config(['access.test_account_emails' => []]);
        $this->getJson('/api/v1/health')->assertJsonPath('test_account_access', false);
    }

    public function test_the_artisan_command_grants_only_a_listed_account_and_only_one(): void
    {
        $user = User::factory()->create(['email' => self::EMAIL, 'plan_id' => Plan::free()->id]);
        $autre = User::factory()->create(['email' => 'camille@example.com', 'plan_id' => Plan::free()->id]);

        $this->artisan('account:test-admin', ['email' => 'camille@example.com'])->assertFailed();
        $this->assertFalse($autre->fresh()->isInternalTestAccount());

        $this->artisan('account:test-admin', ['email' => 'absent@example.com'])->assertFailed();
        $this->assertSame(2, User::query()->count());

        $this->artisan('account:test-admin', ['email' => self::EMAIL])->assertSuccessful();
        $this->assertTrue($user->fresh()->isInternalTestAccount());

        // Un deuxième compte listé ne peut pas être ajouté.
        config(['access.test_account_emails' => [self::EMAIL, 'camille@example.com']]);
        $this->artisan('account:test-admin', ['email' => 'camille@example.com'])->assertFailed();
        $this->assertFalse($autre->fresh()->isInternalTestAccount());

        $user->createToken('t');
        $this->artisan('account:test-admin', ['email' => self::EMAIL, '--revoke' => true])->assertSuccessful();
        $this->assertFalse($user->fresh()->isInternalTestAccount());
        $this->assertSame(0, $user->tokens()->count());
    }

    private function testAccount(): User
    {
        $user = User::factory()->create(['email' => self::EMAIL, 'password' => 'secret-test-1', 'plan_id' => Plan::free()->id]);
        $user->forceFill(['internal_test_account' => true])->save();

        return $user;
    }

    public function test_the_internal_test_account_cannot_be_deleted_via_api(): void
    {
        $user = $this->testAccount();
        $token = $this->tokenOf($user);

        $this->withToken($token)->deleteJson('/api/v1/me', [
            'password' => 'secret-test-1',
        ])->assertForbidden()->assertJsonPath('code', 'test_account_protected');

        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    private function tokenOf(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    /**
     * @return array<string, mixed>
     */
    private function openaiBody(): array
    {
        return [
            'choices' => [[
                'message' => ['content' => json_encode([
                    'titre' => 'Robe noire',
                    'description' => 'Ourlet décousu.',
                    'categorie' => 'Femmes',
                    'sous_categorie' => 'Robes',
                    'marque' => '',
                    'taille' => '',
                    'etat' => 'Bon état',
                    'couleurs' => ['Noir'],
                    'matiere' => '',
                    'prix_suggere' => 15,
                    'a_verifier' => [],
                ])],
            ]],
            'usage' => ['prompt_tokens' => 1000, 'completion_tokens' => 200],
        ];
    }
}
