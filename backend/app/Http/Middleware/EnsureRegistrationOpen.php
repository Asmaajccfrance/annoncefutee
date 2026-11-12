<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRegistrationOpen
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('access.registration')) {
            throw new ApiException('registration_closed', 'Les inscriptions sont fermées.', 403);
        }

        return $next($request);
    }
}
