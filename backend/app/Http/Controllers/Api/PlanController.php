<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use Illuminate\Http\JsonResponse;

class PlanController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $plans = Plan::catalog()
            ->map(fn (Plan $plan): array => $plan->toPublicArray())
            ->values()
            ->all();

        return response()->json([
            'registration_open' => (bool) config('access.registration'),
            'plans' => $plans,
        ]);
    }
}
