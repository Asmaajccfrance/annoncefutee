<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ListingController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('health', HealthController::class);

    Route::middleware('throttle:8,1')->group(function () {
        Route::post('auth/register', [AuthController::class, 'register'])
            ->middleware('registration.open');
        Route::post('auth/login', [AuthController::class, 'login'])
            ->middleware('client.open');
    });

    Route::middleware(['auth:sanctum', 'client.open'])->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::post('listings/analyze', [ListingController::class, 'analyze'])
            ->middleware('throttle:listings');
    });
});
