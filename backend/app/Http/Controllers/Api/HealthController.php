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
            // Booléens seulement : aucune adresse, aucune valeur sensible.
            'client_api' => (bool) config('access.client_api'),
            'test_account_access' => count((array) config('access.test_account_emails', [])) > 0,
        ]);
    }
}
