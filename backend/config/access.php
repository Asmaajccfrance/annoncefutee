<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Accès public
    |--------------------------------------------------------------------------
    |
    | L'installation de test ferme les deux interrupteurs. Les tests automatiques
    | les laissent ouverts. Les valeurs "false" du .env restent fausses après
    | le cache de configuration.
    |
    */

    'registration' => filter_var(env('PUBLIC_REGISTRATION', true), FILTER_VALIDATE_BOOLEAN),

    'client_api' => filter_var(env('CLIENT_API', true), FILTER_VALIDATE_BOOLEAN),

];
