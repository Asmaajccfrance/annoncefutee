<?php

return [

    /*
    | La clé ne sort jamais de ce fichier de configuration. Elle n'est pas
    | journalisée et n'est pas renvoyée par l'API.
    */
    'api_key' => env('OPENAI_API_KEY'),

    'base_url' => rtrim((string) env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), '/'),

    'model' => env('OPENAI_MODEL', 'gpt-5.6-luna'),

    'timeout' => (int) env('OPENAI_TIMEOUT', 60),

    // Les jetons de raisonnement comptent dans cette limite.
    'max_output_tokens' => (int) env('OPENAI_MAX_OUTPUT_TOKENS', 2500),

    'token_limit_field' => env('OPENAI_TOKEN_LIMIT_FIELD', 'max_completion_tokens'),

    'reasoning_effort' => env('OPENAI_REASONING_EFFORT', 'low'),

    'image_detail' => env('OPENAI_IMAGE_DETAIL', 'auto'),

    // Dollars pour un million de jetons. Sert à estimer le coût réel.
    'input_cost_per_million' => (float) env('OPENAI_INPUT_COST_PER_MILLION', 0.20),

    'output_cost_per_million' => (float) env('OPENAI_OUTPUT_COST_PER_MILLION', 1.20),

    /*
    | Photos IA (fond studio, article porté par un mannequin). Appelle POST /images/edits.
    | Les tarifs sont à reprendre de la page de prix d'OpenAI : tant qu'ils valent 0,
    | chaque image est comptée au forfait flat_cost_usd pour que les plafonds restent actifs.
    */
    'image' => [
        'enabled' => (bool) env('OPENAI_IMAGE_ENABLED', true),
        'model' => env('OPENAI_IMAGE_MODEL', 'gpt-image-2.5-sunburst'),
        'quality' => env('OPENAI_IMAGE_QUALITY', 'medium'),
        'size' => env('OPENAI_IMAGE_SIZE', '1024x1536'),
        'input_fidelity' => env('OPENAI_IMAGE_INPUT_FIDELITY', ''),
        'timeout' => (int) env('OPENAI_IMAGE_TIMEOUT', 120),
        'input_cost_per_million' => (float) env('OPENAI_IMAGE_INPUT_COST_PER_MILLION', 0),
        'output_cost_per_million' => (float) env('OPENAI_IMAGE_OUTPUT_COST_PER_MILLION', 0),
        'flat_cost_usd' => (float) env('OPENAI_IMAGE_FLAT_COST_USD', 0.10),
    ],

];
