<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\AnalyzeListingRequest;
use App\Services\Credits\CreditLedger;
use App\Services\Listings\AnalyzeListing;
use Illuminate\Http\JsonResponse;

class ListingController extends Controller
{
    public function analyze(
        AnalyzeListingRequest $request,
        AnalyzeListing $analyze,
        CreditLedger $credits,
    ): JsonResponse {
        $annonce = $analyze->handle(
            $request->user(),
            array_values($request->validated('images')),
            (string) $request->validated('precisions', ''),
            [
                'style' => $request->validated('style', 'normal') ?: 'normal',
                'hashtags' => $request->exists('hashtags') ? $request->boolean('hashtags') : true,
                'signature' => (string) $request->validated('signature', ''),
            ],
        );

        return response()->json([
            'data' => $annonce,
            'credits' => $credits->summary($request->user()),
        ]);
    }
}
