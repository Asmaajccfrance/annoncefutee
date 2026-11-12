<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\UsageEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PrivateAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_home_is_a_holding_page_without_vite(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertSee('Annonce Futée')
            ->assertSee('Ouverture en préparation')
            ->assertSee('pas encore ouvert aux inscriptions', false)
            ->assertDontSee('vite', false)
            ->assertDontSee('<form', false);
    }

    public function test_registration_and_client_api_can_be_closed(): void
    {
        config([
            'access.registration' => false,
            'access.client_api' => false,
        ]);
        Http::fake();

        $this->postJson('/api/v1/auth/register', [
            'name' => 'Camille',
            'email' => 'camille@example.com',
            'password' => 'motdepasse1',
            'password_confirmation' => 'motdepasse1',
        ])->assertForbidden()
            ->assertJsonPath('code', 'registration_closed');

        $this->assertDatabaseCount('users', 0);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'camille@example.com',
            'password' => 'motdepasse1',
        ])->assertForbidden()
            ->assertJsonPath('code', 'client_access_closed');

        $user = User::factory()->create(['plan_id' => Plan::free()->id]);

        $this->withToken($user->createToken('test')->plainTextToken)
            ->postJson('/api/v1/listings/analyze', ['images' => ['pas-une-photo']])
            ->assertForbidden()
            ->assertJsonPath('code', 'client_access_closed');

        Http::assertNothingSent();
        $this->assertSame(0, UsageEvent::query()->count());
        $this->getJson('/api/v1/health')->assertOk();
    }
}
