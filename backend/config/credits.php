<?php

return [

    // Quota du plan gratuit. Les futurs plans payants liront la table plans.
    'monthly_credits' => (int) env('CREDITS_MONTHLY', 30),

    'analysis_cost' => (int) env('CREDITS_ANALYSIS_COST', 1),

    'per_minute' => (int) env('LISTING_MAX_PER_MINUTE', 6),

    'daily_user_cost_usd' => (float) env('LISTING_DAILY_USER_COST_USD', 1),

    'daily_global_cost_usd' => (float) env('LISTING_DAILY_GLOBAL_COST_USD', 25),

    // Une seule analyse à la fois par compte. Le verrou est relâché avant l'appel OpenAI.
    'max_inflight' => (int) env('LISTING_MAX_INFLIGHT', 1),

    // Une réservation plus vieille que ce délai est annulée au prochain essai.
    'reservation_ttl' => (int) env('LISTING_RESERVATION_TTL', 180),

    // Plafond provisoire, remplacé par le coût mesuré. Il bloque les appels concurrents
    // avant que la facture réelle soit connue.
    'reservation_hold_micros' => (int) env('LISTING_RESERVATION_HOLD_MICROS', 20000),

];
