<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'openai_configured' => filled(config('openai.api_key')),
            'model' => (string) config('openai.model'),
        ]);
    }
}
