<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\UsageEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Support\Jpeg;
use Tests\TestCase;

class ListingApiTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'sk-test-not-real';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'openai.api_key' => self::KEY,
            'openai.model' => 'gpt-config-check',
            'openai.base_url' => 'https://api.openai.com/v1',
            'openai.input_cost_per_million' => 0.20,
            'openai.output_cost_per_million' => 1.20,
            'credits.monthly_credits' => 2,
            'credits.analysis_cost' => 1,
            'credits.per_minute' => 30,
            'credits.daily_user_cost_usd' => 1,
            'credits.daily_global_cost_usd' => 25,
        ]);
    }

    public function test_health_does_not_reveal_the_key(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonPath('openai_configured', true)
            ->assertJsonPath('model', 'gpt-config-check')
            ->assertDontSee(self::KEY);
    }

    public function test_register_login_and_logout(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Camille',
            'email' => 'camille@example.com',
            'password' => 'motdepasse1',
            'password_confirmation' => 'motdepasse1',
            'device_name' => 'chrome',
        ])->assertCreated()
            ->assertJsonPath('user.email', 'camille@example.com')
            ->assertJsonMissingPath('user.password');

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => 'camille@example.com',
            'password' => 'motdepasse1',
            'device_name' => 'chrome',
        ])->assertOk();

        $token = $login->json('token');
        $this->assertIsString($token);

        $this->withToken($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('credits.monthly', 2);

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_analyze_requires_a_token_and_one_to_five_photos(): void
    {
        $this->postJson('/api/v1/listings/analyze', ['images' => [$this->photo()]])
            ->assertUnauthorized();

        [$user, $token] = $this->member();
        $this->withToken($token)->postJson('/api/v1/listings/analyze', ['images' => []])
            ->assertUnprocessable();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => array_fill(0, 6, $this->photo()),
        ])->assertUnprocessable();

        $this->assertSame(0, UsageEvent::query()->where('user_id', $user->id)->count());
    }

    public function test_a_successful_analysis_charges_one_credit_and_uses_the_configured_model(): void
    {
        Http::fake([
            'https://api.openai.com/*' => Http::response($this->openaiBody($this->annonce()), 200),
        ]);
        $logged = [];
        Log::listen(function ($event) use (&$logged) {
            $logged[] = $event;
        });
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo(), $this->photo()],
            'precisions' => 'taille M',
            'style' => 'court',
            'hashtags' => false,
        ])->assertOk()
            ->assertJsonPath('data.titre', 'Robe noire')
            ->assertJsonPath('data.sous_categorie', 'Robes')
            ->assertJsonPath('data.etat', 'Bon état')
            ->assertJsonPath('credits.used', 1)
            ->assertJsonPath('credits.remaining', 1);

        Http::assertSent(function ($request) {
            $data = $request->data();

            return $data['model'] === 'gpt-config-check'
                && ($data['response_format']['type'] ?? null) === 'json_schema'
                && ($data['response_format']['json_schema']['strict'] ?? null) === true
                && ($data['response_format']['json_schema']['schema']['additionalProperties'] ?? null) === false
                && ($data['messages'][0]['content'][0]['type'] ?? null) === 'image_url'
                && ! array_key_exists('api_key', $data)
                && $request->hasHeader('Authorization', 'Bearer '.self::KEY);
        });

        $this->assertNotEmpty($logged);
        $encoded = json_encode(array_map(fn ($event) => [$event->message, $event->context], $logged));
        $this->assertStringContainsString('listing.analyze', $encoded);
        $this->assertStringNotContainsString(self::KEY, $encoded);
        $this->assertStringNotContainsString($this->photo(), $encoded);
    }

    public function test_quota_blocks_a_second_paid_call(): void
    {
        config(['credits.monthly_credits' => 1]);
        Http::fake([
            'https://api.openai.com/*' => Http::response($this->openaiBody($this->annonce()), 200),
        ]);
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertOk();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(429)->assertJsonPath('code', 'credits_exhausted');

        Http::assertSentCount(1);
    }

    public function test_invalid_model_output_is_not_charged_but_its_cost_is_kept(): void
    {
        Http::fake([
            'https://api.openai.com/*' => Http::response($this->openaiBody($this->annonce([
                'titre' => ' ',
                'description' => '',
            ])), 200),
        ]);
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(502)->assertJsonPath('code', 'invalid_listing');

        $event = UsageEvent::query()->first();
        $this->assertSame('invalid', $event->status);
        $this->assertSame(0, $event->credits_charged);
        $this->assertSame(440, $event->estimated_cost_micros);
    }

    public function test_daily_cost_ceiling_stops_before_the_provider(): void
    {
        config(['credits.daily_user_cost_usd' => 0.000001]);
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);
        UsageEvent::query()->create([
            'user_id' => $user->id,
            'operation' => 'listing.analyze',
            'status' => 'succeeded',
            'credits_charged' => 0,
            'estimated_cost_micros' => 2,
        ]);
        Http::fake();

        $this->withToken($user->createToken('test')->plainTextToken)
            ->postJson('/api/v1/listings/analyze', ['images' => [$this->photo()]])
            ->assertStatus(429)
            ->assertJsonPath('code', 'cost_ceiling');

        Http::assertNothingSent();
    }

    public function test_a_missing_server_key_never_calls_the_provider(): void
    {
        config(['openai.api_key' => '']);
        Http::fake();
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(503)->assertJsonPath('code', 'openai_not_configured');

        Http::assertNothingSent();
    }

    public function test_rate_limit_applies_per_user(): void
    {
        config(['credits.per_minute' => 1]);
        Http::fake([
            'https://api.openai.com/*' => Http::response($this->openaiBody($this->annonce()), 200),
        ]);
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertOk();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    }

    public function test_photos_must_be_jpeg_within_the_pixel_limits(): void
    {
        Http::fake();
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [base64_encode('ceci-nest-pas-un-jpeg')],
        ])->assertUnprocessable()->assertDontSee('ceci-nest-pas-un-jpeg');

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [Jpeg::make(16, 16)],
        ])->assertUnprocessable();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [Jpeg::make(2100, 40)],
        ])->assertUnprocessable();

        $this->assertSame(0, UsageEvent::query()->count());
        Http::assertNothingSent();
    }

    public function test_a_provider_timeout_releases_the_credit_and_hides_secrets(): void
    {
        config(['app.debug' => true, 'credits.reservation_hold_micros' => 20000]);
        Http::fake(function () {
            throw new ConnectionException(self::KEY);
        });
        $logged = [];
        Log::listen(function ($event) use (&$logged) {
            $logged[] = $event;
        });
        [, $token] = $this->member();
        $photo = $this->photo();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$photo],
            'precisions' => self::KEY,
        ])->assertStatus(504)
            ->assertJsonPath('code', 'openai_timeout')
            ->assertDontSee(self::KEY)
            ->assertDontSee($photo);

        $event = UsageEvent::query()->firstOrFail();
        $this->assertSame('failed', $event->status);
        $this->assertSame(0, $event->credits_charged);
        $this->assertSame(20000, (int) $event->estimated_cost_micros);
        $encoded = json_encode(array_map(fn ($entry) => [$entry->message, $entry->context], $logged));
        $this->assertStringNotContainsString(self::KEY, (string) $encoded);
        $this->assertStringNotContainsString($photo, (string) $encoded);
    }

    public function test_a_provider_rate_limit_does_not_echo_the_upstream_body(): void
    {
        Http::fake(fn () => Http::response(['error' => ['message' => self::KEY]], 429));
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(503)->assertJsonPath('code', 'openai_busy')->assertDontSee(self::KEY);

        $this->assertSame(0, (int) UsageEvent::query()->sum('credits_charged'));
    }

    public function test_a_rejected_provider_request_does_not_echo_the_upstream_body(): void
    {
        Http::fake(fn () => Http::response(['error' => ['message' => self::KEY]], 400));
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(502)->assertJsonPath('code', 'openai_rejected')->assertDontSee(self::KEY);

        $this->assertSame(0, (int) UsageEvent::query()->sum('credits_charged'));
    }

    public function test_malformed_model_json_keeps_the_measured_cost(): void
    {
        Http::fake(fn () => Http::response([
            'choices' => [['message' => ['content' => 'pas-du-json']]],
            'usage' => ['prompt_tokens' => 1000, 'completion_tokens' => 200],
        ], 200));
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(502)->assertJsonPath('code', 'invalid_listing');

        $event = UsageEvent::query()->firstOrFail();
        $this->assertSame('invalid', $event->status);
        $this->assertSame(0, $event->credits_charged);
        $this->assertSame(440, (int) $event->estimated_cost_micros);
    }

    public function test_an_expired_token_is_rejected(): void
    {
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);
        $token = $user->createToken('chrome');
        $token->accessToken->forceFill(['expires_at' => now()->subMinute()])->save();

        $this->withToken($token->plainTextToken)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_an_in_flight_reservation_blocks_a_second_request(): void
    {
        Http::fake();
        [$user, $token] = $this->member();
        UsageEvent::query()->create([
            'user_id' => $user->id,
            'operation' => 'listing.analyze',
            'status' => 'reserved',
            'credits_charged' => 1,
            'estimated_cost_micros' => 1000,
        ]);

        $this->withToken($token)->postJson('/api/v1/listings/analyze', [
            'images' => [$this->photo()],
        ])->assertStatus(429)->assertJsonPath('code', 'analysis_in_progress');

        Http::assertNothingSent();
    }

    /**
     * @return array{0: User, 1: string}
     */
    private function member(): array
    {
        $user = User::factory()->create(['plan_id' => Plan::free()->id]);

        return [$user, $user->createToken('test')->plainTextToken];
    }

    private ?string $cachedPhoto = null;

    private function photo(): string
    {
        return $this->cachedPhoto ??= Jpeg::make();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function annonce(array $overrides = []): array
    {
        return array_merge([
            'titre' => 'Robe noire',
            'description' => 'Ourlet décousu.',
            'categorie' => 'Femmes',
            'sous_categorie' => 'Robes',
            'marque' => '',
            'taille' => '',
            'etat' => 'Bon état',
            'couleurs' => ['Noir', 'Couleur inventée'],
            'matiere' => '',
            'prix_suggere' => 15,
            'a_verifier' => ['Taille illisible'],
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $annonce
     * @return array<string, mixed>
     */
    private function openaiBody(array $annonce): array
    {
        return [
            'choices' => [[
                'message' => ['content' => json_encode($annonce)],
            ]],
            'usage' => [
                'prompt_tokens' => 1000,
                'completion_tokens' => 200,
            ],
        ];
    }
}
