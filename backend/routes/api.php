<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ListingController;
use App\Http\Controllers\Api\PhotoController;
use App\Http\Controllers\Api\PlanController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('health', HealthController::class);
    Route::get('plans', PlanController::class);

    Route::middleware('throttle:8,1')->group(function () {
        Route::post('auth/register', [AuthController::class, 'register'])
            ->middleware('registration.open');
        Route::post('auth/login', [AuthController::class, 'login'])
            ->middleware('client.open:login');
    });

    Route::middleware(['auth:sanctum', 'client.open'])->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::put('me/password', [AuthController::class, 'updatePassword'])
            ->middleware('throttle:8,1');
        Route::delete('me', [AuthController::class, 'destroy'])
            ->middleware('throttle:8,1');
        Route::post('listings/analyze', [ListingController::class, 'analyze'])
            ->middleware('throttle:listings');
        Route::post('photos/enhance', [PhotoController::class, 'enhance'])
            ->middleware('throttle:photos');
    });
});
