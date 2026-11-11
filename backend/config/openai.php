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

];
