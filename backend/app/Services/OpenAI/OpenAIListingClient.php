<?php

namespace App\Services\OpenAI;

use App\Exceptions\ApiException;
use App\Exceptions\IncompleteListing;
use App\Services\Listings\DescriptionBrief;
use App\Services\Listings\ListingCatalog;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OpenAIListingClient
{
    /**
     * @param  list<string>  $images
     * @param  array{style?: string, hashtags?: bool, signature?: string}  $prefs
     * @return array{annonce: array<string, mixed>, usage: array<string, int>}
     */
    public function complete(array $images, string $precisions, array $prefs): array
    {
        $key = (string) config('openai.api_key');
        if ($key === '') {
            throw new ApiException('openai_not_configured', 'Le serveur IA n\'est pas configuré.', 503);
        }

        $content = [];
        foreach ($images as $image) {
            $content[] = [
                'type' => 'image_url',
                'image_url' => [
                    'url' => 'data:image/jpeg;base64,'.$image,
                    'detail' => $this->imageDetail(),
                ],
            ];
        }
        $content[] = ['type' => 'text', 'text' => $this->instructions($precisions, $prefs)];

        $field = (string) config('openai.token_limit_field', 'max_completion_tokens');
        if (! in_array($field, ['max_completion_tokens', 'max_tokens'], true)) {
            $field = 'max_completion_tokens';
        }

        $payload = [
            'model' => (string) config('openai.model'),
            $field => (int) config('openai.max_output_tokens'),
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'annonce',
                    'strict' => true,
                    'schema' => ListingCatalog::schema(),
                ],
            ],
            'messages' => [
                ['role' => 'user', 'content' => $content],
            ],
        ];

        $effort = (string) config('openai.reasoning_effort');
        if (in_array($effort, ['none', 'low', 'medium', 'high', 'xhigh', 'max'], true)) {
            $payload['reasoning_effort'] = $effort;
        }

        try {
            $response = Http::withToken($key)
                ->acceptJson()
                ->connectTimeout(5)
                ->timeout((int) config('openai.timeout', 60))
                ->post(config('openai.base_url').'/chat/completions', $payload);
        } catch (ConnectionException $e) {
            Log::warning('listing.analyze.transport', ['exception' => $e::class]);
            throw new ApiException('openai_timeout', 'Le service IA a mis trop de temps à répondre.', 504);
        } catch (\Throwable $e) {
            Log::warning('listing.analyze.transport', ['exception' => $e::class]);
            throw new ApiException('openai_unavailable', 'Connexion impossible au service IA.', 502);
        }

        if (! $response->successful()) {
            Log::warning('listing.analyze.http', ['status' => $response->status()]);
            throw $this->httpFailure($response->status());
        }

        $body = $response->json();
        $usage = [
            'prompt_tokens' => (int) ($body['usage']['prompt_tokens'] ?? 0),
            'completion_tokens' => (int) ($body['usage']['completion_tokens'] ?? 0),
        ];
        $message = $body['choices'][0]['message'] ?? null;
        $text = is_array($message) ? ($message['content'] ?? null) : null;
        $decoded = is_string($text) ? json_decode($text, true) : null;
        if (! is_array($message) || ! empty($message['refusal']) || ! is_array($decoded)) {
            throw new IncompleteListing($usage);
        }

        return [
            'annonce' => $decoded,
            'usage' => $usage,
        ];
    }

    /**
     * @param  array{prompt_tokens?: int, completion_tokens?: int}  $usage
     */
    public function estimateMicros(array $usage): int
    {
        $input = ($usage['prompt_tokens'] ?? 0) * (float) config('openai.input_cost_per_million');
        $output = ($usage['completion_tokens'] ?? 0) * (float) config('openai.output_cost_per_million');

        return (int) round($input + $output);
    }

    private function httpFailure(int $status): ApiException
    {
        if ($status === 408 || $status === 429) {
            return new ApiException('openai_busy', 'Le service IA est saturé. Réessaie dans un instant.', 503);
        }

        if (in_array($status, [400, 404, 422], true)) {
            return new ApiException('openai_rejected', 'Le service IA a refusé la demande.', 502);
        }

        return new ApiException('openai_unavailable', 'Le service IA est indisponible.', 502);
    }

    /**
     * @param  array{style?: string, hashtags?: bool, signature?: string}  $prefs
     */
    private function instructions(string $precisions, array $prefs): string
    {
        return DescriptionBrief::write($prefs, $precisions);
    }

    private function imageDetail(): string
    {
        $detail = (string) config('openai.image_detail', 'auto');

        return in_array($detail, ['low', 'high', 'auto'], true) ? $detail : 'auto';
    }
}
