<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\UsageEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\Support\Jpeg;
use Tests\TestCase;

class PhotoApiTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'sk-test-not-real';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'openai.api_key' => self::KEY,
            'openai.base_url' => 'https://api.openai.com/v1',
            'openai.image.enabled' => true,
            'openai.image.model' => 'gpt-image-config-check',
            'openai.image.quality' => 'medium',
            'openai.image.size' => '1024x1536',
            'openai.image.input_fidelity' => '',
            'openai.image.input_cost_per_million' => 0,
            'openai.image.output_cost_per_million' => 0,
            'openai.image.flat_cost_usd' => 0.10,
            'credits.monthly_credits' => 12,
            'credits.analysis_cost' => 1,
            'credits.photo_cost' => 5,
            'credits.photos_per_minute' => 30,
            'credits.per_minute' => 30,
            'credits.daily_user_cost_usd' => 1,
            'credits.daily_global_cost_usd' => 25,
        ]);
    }

    public function test_a_photo_requires_a_token_a_jpeg_and_a_known_mode(): void
    {
        Http::fake();
        $this->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertUnauthorized();

        [$user, $token] = $this->member();
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['mode' => 'studio'])
            ->assertUnprocessable();
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'mode_inconnu'])
            ->assertUnprocessable();
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => base64_encode('pas une image du tout'), 'mode' => 'studio'])
            ->assertUnprocessable();

        Http::assertNothingSent();
        $this->assertSame(0, UsageEvent::query()->where('user_id', $user->id)->count());
    }

    public function test_a_studio_photo_charges_its_credits_and_calls_the_image_model(): void
    {
        $result = Jpeg::make(96, 144);
        Http::fake([
            'https://api.openai.com/v1/images/edits' => Http::response([
                'data' => [['b64_json' => $result]],
                'usage' => ['input_tokens' => 400, 'output_tokens' => 1500],
            ], 200),
        ]);
        [$user, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertOk()
            ->assertJsonPath('data.image', $result)
            ->assertJsonPath('data.mode', 'studio')
            ->assertJsonPath('data.generated_by_ai', true)
            ->assertJsonPath('credits.used', 5)
            ->assertJsonPath('credits.remaining', 7)
            ->assertJsonPath('credits.photo_cost', 5)
            ->assertDontSee(self::KEY);

        Http::assertSent(function (Request $request) {
            $body = $request->body();

            return $request->url() === 'https://api.openai.com/v1/images/edits'
                && $request->hasHeader('Authorization', 'Bearer '.self::KEY)
                && $request->isMultipart()
                && str_contains($body, 'name="image[]"')
                && str_contains($body, 'gpt-image-config-check')
                && str_contains($body, '1024x1536')
                && str_contains($body, 'bien à plat')
                && ! str_contains($body, 'input_fidelity');
        });

        $event = UsageEvent::query()->where('user_id', $user->id)->sole();
        $this->assertSame('photo.enhance', $event->operation);
        $this->assertSame('succeeded', $event->status);
        $this->assertSame(5, $event->credits_charged);
        $this->assertSame(100000, $event->estimated_cost_micros);
        $this->assertSame('gpt-image-config-check', $event->model);
        $this->assertSame(400, $event->prompt_tokens);
        $this->assertSame(1500, $event->completion_tokens);
    }

    public function test_a_free_request_is_sent_with_the_photo_and_still_costs_credits(): void
    {
        Http::fake([
            'https://api.openai.com/v1/images/edits' => Http::response([
                'data' => [['b64_json' => Jpeg::make()]],
                'usage' => ['input_tokens' => 10, 'output_tokens' => 10],
            ], 200),
        ]);
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/photos/enhance', [
            'image' => $this->photo(),
            'mode' => 'studio',
            'consigne' => 'Un mur de briques claires',
        ])->assertOk()->assertJsonPath('credits.used', 5);

        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'Un mur de briques claires')
            && str_contains($request->body(), 'sans modifier'));

        $this->withToken($token)->postJson('/api/v1/photos/enhance', [
            'image' => $this->photo(),
            'mode' => 'studio',
            'consigne' => str_repeat('a', 301),
        ])->assertUnprocessable();
    }

    public function test_token_rates_replace_the_flat_cost_and_fidelity_is_sent_when_configured(): void
    {
        config([
            'openai.image.input_cost_per_million' => 10,
            'openai.image.output_cost_per_million' => 40,
            'openai.image.input_fidelity' => 'high',
        ]);
        Http::fake([
            'https://api.openai.com/*' => Http::response([
                'data' => [['b64_json' => Jpeg::make()]],
                'usage' => ['input_tokens' => 1000, 'output_tokens' => 2000],
            ], 200),
        ]);
        [$user, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'mannequin_femme'])
            ->assertOk();

        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'input_fidelity')
            && str_contains($request->body(), 'une femme adulte')
            && str_contains($request->body(), 'vêtement pour enfant'));
        $this->assertSame(1000 * 10 + 2000 * 40, UsageEvent::query()->where('user_id', $user->id)->sole()->estimated_cost_micros);
    }

    public function test_a_failed_or_empty_generation_charges_nothing(): void
    {
        [$user, $token] = $this->member();
        Http::fake(['https://api.openai.com/*' => Http::sequence()
            ->push(['error' => ['code' => 'server_error']], 500)
            ->push(['data' => []], 200)
            ->push(['error' => ['code' => 'moderation_blocked']], 400)]);

        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(502)->assertJsonPath('code', 'openai_unavailable');
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(502)->assertJsonPath('code', 'invalid_photo_result');
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'mannequin_homme'])
            ->assertStatus(422)->assertJsonPath('code', 'photo_refused');

        $this->assertSame(3, UsageEvent::query()->where('user_id', $user->id)->count());
        $this->assertSame(0, (int) UsageEvent::query()->where('user_id', $user->id)->sum('credits_charged'));
        $this->assertSame(0, UsageEvent::query()->where('user_id', $user->id)->where('status', 'reserved')->count());
        $this->withToken($token)->getJson('/api/v1/me')->assertJsonPath('credits.remaining', 12);
    }

    public function test_a_timeout_charges_nothing(): void
    {
        [$user, $token] = $this->member();
        Http::fake(fn () => throw new ConnectionException('timeout'));

        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(504)->assertJsonPath('code', 'openai_timeout');

        $this->assertSame(0, (int) UsageEvent::query()->where('user_id', $user->id)->sum('credits_charged'));
        $this->assertSame('failed', UsageEvent::query()->where('user_id', $user->id)->sole()->status);
    }

    public function test_the_quota_blocks_a_photo_that_costs_more_than_what_is_left(): void
    {
        Http::fake(['https://api.openai.com/*' => Http::response(['data' => [['b64_json' => Jpeg::make()]]], 200)]);
        [, $token] = $this->member();

        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])->assertOk();
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])->assertOk();
        // 12 crédits, deux photos à 5 : il en reste 2, pas assez pour une troisième.
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(429)->assertJsonPath('code', 'credits_exhausted');
        Http::assertSentCount(2);
    }

    public function test_a_photo_in_progress_does_not_block_a_listing_analysis_and_the_reverse(): void
    {
        [$user] = $this->member();
        $ledger = app(\App\Services\Credits\CreditLedger::class);

        $photo = $ledger->reserve($user, 5, 'photo.enhance', 100000);
        $analyse = $ledger->reserve($user, 1);
        $this->assertSame('photo.enhance', $photo->operation);
        $this->assertSame('listing.analyze', $analyse->operation);

        try {
            $ledger->reserve($user, 5, 'photo.enhance', 100000);
            $this->fail('Une seconde photo simultanée aurait dû être refusée.');
        } catch (\App\Exceptions\ApiException $e) {
            $this->assertSame('photo_in_progress', $e->errorCode);
        }
    }

    public function test_photos_can_be_switched_off_and_respect_the_daily_cost_ceiling(): void
    {
        Http::fake(['https://api.openai.com/*' => Http::response(['data' => [['b64_json' => Jpeg::make()]]], 200)]);
        [, $token] = $this->member();

        config(['openai.image.enabled' => false]);
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(503)->assertJsonPath('code', 'photo_disabled');

        config(['openai.image.enabled' => true, 'credits.daily_user_cost_usd' => 0.15, 'credits.monthly_credits' => 100]);
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])->assertOk();
        // 0,10 $ déjà estimés + 0,10 $ réservés dépasseraient le plafond de 0,15 $.
        $this->withToken($token)->postJson('/api/v1/photos/enhance', ['image' => $this->photo(), 'mode' => 'studio'])
            ->assertStatus(429)->assertJsonPath('code', 'cost_ceiling');
        Http::assertSentCount(1);
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
}
