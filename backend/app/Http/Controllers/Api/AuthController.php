<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\DeleteAccountRequest;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Requests\UpdatePasswordRequest;
use App\Models\Plan;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request, CreditLedger $credits): JsonResponse
    {
        $planSlug = $request->string('plan', 'free')->toString();
        $plan = Plan::query()->where('slug', $planSlug)->first() ?? Plan::free();
        if (! $plan->is_active) {
            throw new ApiException(
                'plan_inactive',
                'Ce forfait n\'est pas encore disponible. Seule l\'offre découverte gratuite est ouverte.',
                422,
            );
        }

        $user = User::query()->create([
            'name' => $request->string('name')->toString(),
            'email' => $request->string('email')->toString(),
            'password' => $request->string('password')->toString(),
            'plan_id' => $plan->id,
        ]);

        return $this->tokenResponse($user, $request->input('device_name', 'api'), $credits, 201);
    }

    public function login(LoginRequest $request, CreditLedger $credits): JsonResponse
    {
        $user = User::query()->where('email', $request->string('email')->toString())->first();
        if (! $user || ! Hash::check($request->string('password')->toString(), $user->password)) {
            throw ValidationException::withMessages([
                'email' => 'Identifiants incorrects.',
            ]);
        }

        // Service fermé : même un mot de passe exact ne suffit pas, le compte doit être un compte de test interne.
        if (! config('access.client_api') && ! $user->isInternalTestAccount()) {
            throw new ApiException('client_access_closed', 'Le service n\'est pas encore ouvert.', 403);
        }

        return $this->tokenResponse($user, $request->input('device_name', 'api'), $credits, 200);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $current = $user?->currentAccessToken();

        if ($current instanceof \Laravel\Sanctum\PersonalAccessToken) {
            $current->delete();
        } else {
            $user?->tokens()->delete();
        }

        return response()->json(['ok' => true]);
    }

    public function me(Request $request, CreditLedger $credits): JsonResponse
    {
        return response()->json($this->profile($request->user(), $credits));
    }

    public function updatePassword(UpdatePasswordRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        if (! Hash::check($request->string('current_password')->toString(), $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => 'Mot de passe actuel incorrect.',
            ]);
        }

        $nouveau = $request->string('password')->toString();
        if (Hash::check($nouveau, $user->password)) {
            throw ValidationException::withMessages([
                'password' => 'Choisis un mot de passe différent de l\'actuel.',
            ]);
        }

        $user->password = $nouveau;
        $user->save();

        $current = $user->currentAccessToken();
        if ($current instanceof \Laravel\Sanctum\PersonalAccessToken) {
            $user->tokens()->where('id', '!=', $current->id)->delete();
        }

        return response()->json([
            'ok' => true,
            'message' => 'Mot de passe mis à jour.',
        ]);
    }

    public function destroy(DeleteAccountRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        if (! Hash::check($request->string('password')->toString(), $user->password)) {
            throw ValidationException::withMessages([
                'password' => 'Mot de passe incorrect.',
            ]);
        }

        if ($user->isInternalTestAccount()) {
            throw new ApiException(
                'test_account_protected',
                'Ce compte de test interne ne peut pas être supprimé depuis l\'application.',
                403,
            );
        }

        DB::transaction(function () use ($user): void {
            $user->tokens()->delete();
            $user->delete();
        });

        return response()->json([
            'ok' => true,
            'message' => 'Compte supprimé définitivement.',
        ]);
    }

    private function tokenResponse(User $user, string $device, CreditLedger $credits, int $status): JsonResponse
    {
        $token = $user->createToken(mb_substr($device, 0, 80))->plainTextToken;

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            ...$this->profile($user, $credits),
        ], $status);
    }

    /**
     * @return array<string, mixed>
     */
    private function profile(User $user, CreditLedger $credits): array
    {
        $user->loadMissing('plan');
        $plan = $user->plan ?? Plan::free();

        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'test_account' => $user->isInternalTestAccount(),
                'plan_slug' => $plan->slug,
                'plan_name' => $plan->name,
            ],
            'credits' => $credits->summary($user),
        ];
    }
}
