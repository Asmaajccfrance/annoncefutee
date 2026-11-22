<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('listings', function (Request $request) {
            $perMinute = max(1, (int) config('credits.per_minute'));

            return Limit::perMinute($perMinute)
                ->by((string) ($request->user()?->getAuthIdentifier() ?: $request->ip()))
                ->response(function () {
                    return response()->json([
                        'message' => 'Trop de demandes. Réessaie dans une minute.',
                        'code' => 'rate_limited',
                    ], 429);
                });
        });

        RateLimiter::for('photos', function (Request $request) {
            $perMinute = max(1, (int) config('credits.photos_per_minute'));

            return Limit::perMinute($perMinute)
                ->by('photos:'.($request->user()?->getAuthIdentifier() ?: $request->ip()))
                ->response(function () {
                    return response()->json([
                        'message' => 'Trop de demandes. Réessaie dans une minute.',
                        'code' => 'rate_limited',
                    ], 429);
                });
        });
    }
}
