<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Marque un compte comme « compte de test interne ». Le drapeau seul ne donne aucun droit :
     * l'adresse doit aussi figurer dans TEST_ACCOUNT_EMAILS (voir User::isInternalTestAccount).
     * La colonne n'est jamais remplissable en masse : seule la commande `account:test-admin` l'écrit.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('internal_test_account')->default(false)->after('plan_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('internal_test_account');
        });
    }
};
