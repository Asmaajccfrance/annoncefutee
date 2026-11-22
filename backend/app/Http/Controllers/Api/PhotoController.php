<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\EnhancePhotoRequest;
use App\Services\Credits\CreditLedger;
use App\Services\Photos\EnhancePhoto;
use Illuminate\Http\JsonResponse;

class PhotoController extends Controller
{
    public function enhance(
        EnhancePhotoRequest $request,
        EnhancePhoto $enhance,
        CreditLedger $credits,
    ): JsonResponse {
        $image = $enhance->handle(
            $request->user(),
            (string) $request->validated('image'),
            (string) $request->validated('mode'),
            trim((string) ($request->validated('consigne') ?? '')),
        );

        return response()->json([
            'data' => [
                'image' => $image,
                'mode' => (string) $request->validated('mode'),
                'generated_by_ai' => true,
            ],
            'credits' => $credits->summary($request->user()),
        ]);
    }
}
