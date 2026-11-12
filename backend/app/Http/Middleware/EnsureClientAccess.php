<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureClientAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('access.client_api')) {
            throw new ApiException('client_access_closed', 'Le service n\'est pas encore ouvert.', 403);
        }

        return $next($request);
    }
}
