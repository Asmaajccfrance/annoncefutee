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

    /*
    |--------------------------------------------------------------------------
    | Comptes de test internes
    |--------------------------------------------------------------------------
    |
    | Liste d'adresses (séparées par des virgules) qui peuvent se connecter même
    | quand CLIENT_API=false, et qui n'ont pas de quota de crédits. Un compte n'a
    | ces droits que si son adresse est ICI ET si le drapeau internal_test_account
    | est posé en base (commande `php artisan account:test-admin`). Vide = aucun.
    | Les plafonds financiers et les protections anti-répétition restent actifs.
    |
    */

    'test_account_emails' => array_values(array_filter(array_map(
        fn (string $email): string => strtolower(trim($email)),
        explode(',', (string) env('TEST_ACCOUNT_EMAILS', ''))
    ))),

];
