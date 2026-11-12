<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class TestAccountCommand extends Command
{
    protected $signature = 'account:test-admin
        {email : Adresse du compte existant}
        {--revoke : Retire le statut de compte de test}
        {--status : Affiche l\'état sans rien modifier}';

    protected $description = 'Accorde (ou retire) le statut de compte de test interne : sans quota de crédits, autorisé même service fermé.';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->error('Aucun compte avec cette adresse. Cette commande ne crée jamais de compte.');

            return self::FAILURE;
        }

        if ($this->option('status')) {
            $this->line('Adresse autorisée par TEST_ACCOUNT_EMAILS : '.(User::isTestAccountEmail($email) ? 'oui' : 'non'));
            $this->line('Drapeau en base : '.($user->internal_test_account ? 'oui' : 'non'));
            $this->line('Compte de test effectif : '.($user->isInternalTestAccount() ? 'OUI (sans quota de crédits)' : 'non'));

            return self::SUCCESS;
        }

        if ($this->option('revoke')) {
            $user->forceFill(['internal_test_account' => false])->save();
            $user->tokens()->delete();
            $this->info('Statut retiré et jetons révoqués pour '.$email.'.');

            return self::SUCCESS;
        }

        if (! User::isTestAccountEmail($email)) {
            $this->error('Refusé : cette adresse n\'est pas dans TEST_ACCOUNT_EMAILS (fichier .env du serveur). Ajoute-la d\'abord, puis relance la commande.');

            return self::FAILURE;
        }

        $autre = User::query()
            ->where('internal_test_account', true)
            ->where('id', '!=', $user->id)
            ->first();
        if ($autre !== null) {
            $this->error('Refusé : un autre compte est déjà compte de test. Il ne peut y en avoir qu\'un.');

            return self::FAILURE;
        }

        $user->forceFill(['internal_test_account' => true])->save();
        $this->info('Compte de test interne activé pour '.$email.' : pas de quota de crédits, plafonds financiers conservés.');

        return self::SUCCESS;
    }
}
