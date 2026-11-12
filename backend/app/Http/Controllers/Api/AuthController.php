<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Models\Plan;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request, CreditLedger $credits): JsonResponse
    {
        $user = User::query()->create([
            'name' => $request->string('name')->toString(),
            'email' => $request->string('email')->toString(),
            'password' => $request->string('password')->toString(),
            'plan_id' => Plan::free()->id,
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
        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'test_account' => $user->isInternalTestAccount(),
            ],
            'credits' => $credits->summary($user),
        ];
    }
}
