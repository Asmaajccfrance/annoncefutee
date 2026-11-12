<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiException;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureClientAccess
{
    /**
     * Service ouvert (CLIENT_API=true) : tout le monde passe, comme avant.
     * Service fermé : seuls les comptes de test internes passent.
     *   - mode « login »  : avant l'authentification, seule l'adresse du compte de test est acceptée
     *                       (aucune vérification de mot de passe n'est faite pour les autres adresses) ;
     *   - mode par défaut : le jeton doit appartenir à un compte de test interne authentifié.
     */
    public function handle(Request $request, Closure $next, string $mode = 'auth'): Response
    {
        if (config('access.client_api')) {
            return $next($request);
        }

        if ($mode === 'login') {
            $email = $request->input('email');
            if (is_string($email) && User::isTestAccountEmail($email)) {
                return $next($request);
            }
        } else {
            $user = $request->user();
            if ($user instanceof User && $user->isInternalTestAccount()) {
                return $next($request);
            }
        }

        throw new ApiException('client_access_closed', 'Le service n\'est pas encore ouvert.', 403);
    }
}
