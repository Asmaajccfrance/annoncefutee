<?php

namespace App\Services\Listings;

use App\Exceptions\ApiException;
use App\Exceptions\IncompleteListing;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use App\Services\OpenAI\OpenAIListingClient;
use Illuminate\Support\Facades\Log;

class AnalyzeListing
{
    public function __construct(
        private CreditLedger $credits,
        private OpenAIListingClient $client,
        private ListingValidator $validator,
    ) {}

    /**
     * @param  list<string>  $images
     * @param  array{style?: string, hashtags?: bool, signature?: string}  $prefs
     * @return array<string, mixed>
     */
    public function handle(User $user, array $images, string $precisions, array $prefs): array
    {
        if ((string) config('openai.api_key') === '') {
            throw new ApiException('openai_not_configured', 'Le serveur IA n\'est pas configuré.', 503);
        }

        $event = $this->credits->reserve($user, $this->credits->analysisCost($user));
        $started = hrtime(true);

        try {
            $raw = $this->client->complete($images, $precisions, $prefs);
        } catch (IncompleteListing $e) {
            $duration = $this->elapsed($started);
            $micros = $this->client->estimateMicros($e->usage);
            $this->credits->release($event, 'invalid', [
                'prompt_tokens' => $e->usage['prompt_tokens'],
                'completion_tokens' => $e->usage['completion_tokens'],
                'estimated_cost_micros' => $micros,
                'model' => (string) config('openai.model'),
                'duration_ms' => $duration,
                'error_code' => $e->errorCode,
            ]);
            $this->log('invalid', $user, $micros, $duration, $e->errorCode);
            throw $e;
        } catch (ApiException $e) {
            $this->credits->release($event, 'failed', [
                'error_code' => $e->errorCode,
                'duration_ms' => $this->elapsed($started),
                'model' => (string) config('openai.model'),
            ]);
            $this->log('failed', $user, 0, $this->elapsed($started), $e->errorCode);
            throw $e;
        }

        $duration = $this->elapsed($started);
        $micros = $this->client->estimateMicros($raw['usage']);
        $usage = [
            'prompt_tokens' => $raw['usage']['prompt_tokens'],
            'completion_tokens' => $raw['usage']['completion_tokens'],
            'estimated_cost_micros' => $micros,
            'model' => (string) config('openai.model'),
            'duration_ms' => $duration,
        ];

        try {
            $annonce = $this->validator->validate($raw['annonce']);
        } catch (ApiException $e) {
            $this->credits->release($event, 'invalid', array_merge($usage, [
                'error_code' => $e->errorCode,
            ]));
            $this->log('invalid', $user, $micros, $duration, $e->errorCode);
            throw $e;
        }

        $this->credits->settle($event, $usage);
        $this->log('succeeded', $user, $micros, $duration, null);

        return $annonce;
    }

    private function elapsed(int $started): int
    {
        return (int) ((hrtime(true) - $started) / 1_000_000);
    }

    private function log(string $status, User $user, int $micros, int $duration, ?string $error): void
    {
        Log::info('listing.analyze', array_filter([
            'user_id' => $user->id,
            'status' => $status,
            'model' => (string) config('openai.model'),
            'estimated_cost_micros' => $micros,
            'duration_ms' => $duration,
            'error_code' => $error,
        ], fn ($value) => $value !== null));
    }
}
