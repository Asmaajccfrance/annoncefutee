<?php

namespace App\Console\Commands;

use App\Services\Listings\ListingCatalog;
use App\Services\OpenAI\OpenAIListingClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class ProbeOpenAI extends Command
{
    protected $signature = 'listings:probe';

    protected $description = 'Vérifie l\'accès au modèle configuré. N\'affiche jamais la clé.';

    public function handle(OpenAIListingClient $client): int
    {
        $schema = json_encode(ListingCatalog::schema());
        $strict = is_string($schema)
            && ! preg_match('/"(minLength|maxLength|minItems|maxItems|minimum|maximum|pattern|format)"/', $schema);
        $this->line('schema_strict='.($strict ? 'ok' : 'incompatible'));
        if (! $strict) {
            return self::FAILURE;
        }

        $key = (string) config('openai.api_key');
        if ($key === '') {
            $this->line('openai_key=absent');
            $this->line('model_access=not_run');

            return self::FAILURE;
        }

        $model = (string) config('openai.model');
        try {
            $access = Http::withToken($key)
                ->acceptJson()
                ->timeout(20)
                ->get(rtrim((string) config('openai.base_url'), '/').'/models/'.$model);
        } catch (\Throwable $e) {
            $this->line('model_access=unreachable exception='.$e::class);

            return self::FAILURE;
        }

        $id = $access->json('id');
        if ($access->status() === 200 && $id === $model) {
            $this->line('model_access=confirmed');
        } else {
            $this->line('model_access=denied status='.$access->status());

            return self::FAILURE;
        }

        $one = $this->jpeg('PULL MARINE COTON TAILLE M');
        $set = [
            $one,
            $this->jpeg('ETIQUETTE COTON TAILLE M'),
            $this->jpeg('DOS UNI MARINE'),
            $this->jpeg('COUTURE LATERALE'),
            $this->jpeg('TROU AU COUDE'),
        ];

        if (! $this->measure($client, 'photos_1', [$one])) {
            return self::FAILURE;
        }
        if (! $this->measure($client, 'photos_5', $set)) {
            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /**
     * @param  list<string>  $images
     */
    private function measure(OpenAIListingClient $client, string $label, array $images): bool
    {
        $started = hrtime(true);
        try {
            $result = $client->complete($images, 'Coton, taille M, trou au coude. Pas de marque visible.', [
                'style' => 'normal',
                'hashtags' => false,
                'signature' => '',
            ]);
        } catch (\Throwable $e) {
            $code = $e instanceof \App\Exceptions\ApiException ? $e->errorCode : $e::class;
            $this->line($label.'_error='.$code);

            return false;
        }

        $ms = (int) ((hrtime(true) - $started) / 1_000_000);
        $micros = $client->estimateMicros($result['usage']);
        $annonce = $result['annonce'];
        $this->line($label.'_ms='.$ms);
        $this->line($label.'_prompt_tokens='.$result['usage']['prompt_tokens']);
        $this->line($label.'_completion_tokens='.$result['usage']['completion_tokens']);
        $this->line($label.'_estimated_usd='.number_format($micros / 1_000_000, 6, '.', ''));
        $this->line($label.'_titre='.$this->plain($annonce['titre'] ?? ''));
        $this->line($label.'_marque='.$this->plain($annonce['marque'] ?? ''));
        $this->line($label.'_taille='.$this->plain($annonce['taille'] ?? ''));
        $this->line($label.'_matiere='.$this->plain($annonce['matiere'] ?? ''));
        $this->line($label.'_etat='.$this->plain($annonce['etat'] ?? ''));
        $this->line($label.'_prix='.(string) ($annonce['prix_suggere'] ?? ''));
        $this->line($label.'_categorie='.$this->plain(($annonce['categorie'] ?? '').' / '.($annonce['sous_categorie'] ?? '')));

        return true;
    }

    private function plain(mixed $value): string
    {
        $text = trim(preg_replace('/\s+/', ' ', (string) $value) ?? '');

        return substr($text, 0, 180);
    }

    private function jpeg(string $label): string
    {
        $image = imagecreatetruecolor(640, 480);
        $background = imagecolorallocate($image, 18, 42, 92);
        $ink = imagecolorallocate($image, 255, 255, 255);
        imagefilledrectangle($image, 0, 0, 639, 479, $background);
        imagestring($image, 5, 24, 24, $label, $ink);
        ob_start();
        imagejpeg($image, null, 85);
        $binary = ob_get_clean();
        imagedestroy($image);

        return base64_encode($binary === false ? '' : $binary);
    }
}
