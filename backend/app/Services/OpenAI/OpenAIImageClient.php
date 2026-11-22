<?php

namespace App\Services\OpenAI;

use App\Exceptions\ApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OpenAIImageClient
{
    /**
     * Envoie une photo JPEG et une consigne au modèle d'image, et renvoie l'image produite.
     *
     * @return array{image: string, usage: array{prompt_tokens: int, completion_tokens: int}}
     */
    public function edit(string $jpegBase64, string $prompt): array
    {
        $key = (string) config('openai.api_key');
        if ($key === '') {
            throw new ApiException('openai_not_configured', 'Le serveur IA n\'est pas configuré.', 503);
        }

        $binary = base64_decode($jpegBase64, true);
        if ($binary === false || $binary === '') {
            throw new ApiException('invalid_photo', 'Photo illisible.', 422);
        }

        $fields = [
            'model' => $this->model(),
            'prompt' => $prompt,
            'n' => '1',
            'size' => (string) config('openai.image.size', '1024x1536'),
            'output_format' => 'jpeg',
            'output_compression' => '90',
        ];
        $quality = (string) config('openai.image.quality', 'medium');
        if (in_array($quality, ['low', 'medium', 'high', 'xhigh', 'max', 'auto'], true)) {
            $fields['quality'] = $quality;
        }
        // Certains modèles refusent ce paramètre : il n'est envoyé que s'il est configuré.
        $fidelity = (string) config('openai.image.input_fidelity', '');
        if (in_array($fidelity, ['high', 'low'], true)) {
            $fields['input_fidelity'] = $fidelity;
        }

        try {
            $response = Http::withToken($key)
                ->acceptJson()
                ->connectTimeout(5)
                ->timeout((int) config('openai.image.timeout', 120))
                ->attach('image[]', $binary, 'photo.jpg', ['Content-Type' => 'image/jpeg'])
                ->post(config('openai.base_url').'/images/edits', $fields);
        } catch (ConnectionException $e) {
            Log::warning('photo.enhance.transport', ['exception' => $e::class]);
            throw new ApiException('openai_timeout', 'Le service IA a mis trop de temps à répondre.', 504);
        } catch (\Throwable $e) {
            Log::warning('photo.enhance.transport', ['exception' => $e::class]);
            throw new ApiException('openai_unavailable', 'Connexion impossible au service IA.', 502);
        }

        if (! $response->successful()) {
            $code = (string) ($response->json('error.code') ?? '');
            Log::warning('photo.enhance.http', ['status' => $response->status(), 'code' => $code]);
            throw $this->httpFailure($response->status(), $code);
        }

        $body = $response->json();
        $image = $body['data'][0]['b64_json'] ?? null;
        if (! is_string($image) || $image === '' || base64_decode($image, true) === false) {
            throw new ApiException('invalid_photo_result', 'Le service IA n\'a pas renvoyé d\'image.', 502);
        }

        return [
            'image' => $image,
            'usage' => [
                'prompt_tokens' => (int) ($body['usage']['input_tokens'] ?? 0),
                'completion_tokens' => (int) ($body['usage']['output_tokens'] ?? 0),
            ],
        ];
    }

    public function model(): string
    {
        return (string) config('openai.image.model', 'gpt-image-2.5-sunburst');
    }

    /**
     * Coût estimé d'une image. Si les tarifs au jeton ne sont pas renseignés, un forfait prudent s'applique
     * pour que les plafonds de dépense restent actifs.
     *
     * @param  array{prompt_tokens?: int, completion_tokens?: int}  $usage
     */
    public function estimateMicros(array $usage): int
    {
        $in = (float) config('openai.image.input_cost_per_million', 0);
        $out = (float) config('openai.image.output_cost_per_million', 0);
        $tokens = ($usage['prompt_tokens'] ?? 0) + ($usage['completion_tokens'] ?? 0);
        if (($in <= 0 && $out <= 0) || $tokens <= 0) {
            return (int) round(((float) config('openai.image.flat_cost_usd', 0.10)) * 1_000_000);
        }

        return (int) round(($usage['prompt_tokens'] ?? 0) * $in + ($usage['completion_tokens'] ?? 0) * $out);
    }

    private function httpFailure(int $status, string $code): ApiException
    {
        if ($status === 408 || $status === 429) {
            return new ApiException('openai_busy', 'Le service IA est saturé. Réessaie dans un instant.', 503);
        }

        if ($code === 'moderation_blocked' || $code === 'content_policy_violation') {
            return new ApiException('photo_refused', 'Le service IA a refusé cette photo.', 422);
        }

        if (in_array($status, [400, 401, 403, 404, 422], true)) {
            return new ApiException('openai_rejected', 'Le service IA a refusé la demande.', 502);
        }

        return new ApiException('openai_unavailable', 'Le service IA est indisponible.', 502);
    }
}
