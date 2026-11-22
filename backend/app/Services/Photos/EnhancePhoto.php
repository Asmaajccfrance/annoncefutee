<?php

namespace App\Services\Photos;

use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use App\Services\OpenAI\OpenAIImageClient;
use Illuminate\Support\Facades\Log;

class EnhancePhoto
{
    public const OPERATION = 'photo.enhance';

    public function __construct(
        private CreditLedger $credits,
        private OpenAIImageClient $client,
    ) {}

    /**
     * @return string image JPEG en base64
     */
    public function handle(User $user, string $image, string $mode, string $consigne = ''): string
    {
        if ((string) config('openai.api_key') === '') {
            throw new ApiException('openai_not_configured', 'Le serveur IA n\'est pas configuré.', 503);
        }
        if (! (bool) config('openai.image.enabled', true)) {
            throw new ApiException('photo_disabled', 'Les photos IA ne sont pas activées sur ce serveur.', 503);
        }

        $event = $this->credits->reserve(
            $user,
            $this->credits->photoCost($user),
            self::OPERATION,
            max(0, (int) config('credits.photo_hold_micros')),
        );
        $started = hrtime(true);

        // Une image demande nettement plus de temps qu'une analyse de texte.
        if (function_exists('set_time_limit')) {
            @set_time_limit((int) config('openai.image.timeout', 120) + 20);
        }

        try {
            $result = $this->client->edit($image, PhotoBrief::write($mode, $consigne));
        } catch (ApiException $e) {
            $this->credits->release($event, 'failed', [
                'error_code' => $e->errorCode,
                'duration_ms' => $this->elapsed($started),
                'model' => $this->client->model(),
            ]);
            $this->log('failed', $user, $mode, 0, $this->elapsed($started), $e->errorCode);
            throw $e;
        }

        $duration = $this->elapsed($started);
        $micros = $this->client->estimateMicros($result['usage']);
        $this->credits->settle($event, [
            'prompt_tokens' => $result['usage']['prompt_tokens'],
            'completion_tokens' => $result['usage']['completion_tokens'],
            'estimated_cost_micros' => $micros,
            'model' => $this->client->model(),
            'duration_ms' => $duration,
        ]);
        $this->log('succeeded', $user, $mode, $micros, $duration, null);

        return $result['image'];
    }

    private function elapsed(int $started): int
    {
        return (int) ((hrtime(true) - $started) / 1_000_000);
    }

    private function log(string $status, User $user, string $mode, int $micros, int $duration, ?string $error): void
    {
        Log::info('photo.enhance', array_filter([
            'user_id' => $user->id,
            'status' => $status,
            'mode' => $mode,
            'model' => $this->client->model(),
            'estimated_cost_micros' => $micros,
            'duration_ms' => $duration,
            'error_code' => $error,
        ], fn ($value) => $value !== null));
    }
}
