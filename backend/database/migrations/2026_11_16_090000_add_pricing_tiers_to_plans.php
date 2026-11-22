<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->unsignedInteger('price_euros')->default(0)->after('name');
            $table->unsignedInteger('sort_order')->default(0)->after('price_euros');
        });

        $now = now();

        DB::table('plans')->where('slug', 'free')->update([
            'name' => 'Découverte',
            'price_euros' => 0,
            'sort_order' => 1,
            'is_active' => true,
            'updated_at' => $now,
        ]);

        $tiers = [
            [
                'slug' => 'essentiel',
                'name' => 'Essentiel',
                'price_euros' => 7,
                'sort_order' => 2,
                'monthly_credits' => 100,
                'analysis_cost' => 1,
                'is_active' => false,
            ],
            [
                'slug' => 'vendeur',
                'name' => 'Vendeur',
                'price_euros' => 14,
                'sort_order' => 3,
                'monthly_credits' => 250,
                'analysis_cost' => 1,
                'is_active' => false,
            ],
            [
                'slug' => 'boutique',
                'name' => 'Boutique',
                'price_euros' => 39,
                'sort_order' => 4,
                'monthly_credits' => 800,
                'analysis_cost' => 1,
                'is_active' => false,
            ],
        ];

        foreach ($tiers as $tier) {
            DB::table('plans')->updateOrInsert(
                ['slug' => $tier['slug']],
                array_merge($tier, [
                    'stripe_price_id' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]),
            );
        }
    }

    public function down(): void
    {
        DB::table('plans')->whereIn('slug', ['essentiel', 'vendeur', 'boutique'])->delete();
        DB::table('plans')->where('slug', 'free')->update(['name' => 'Gratuit']);

        Schema::table('plans', function (Blueprint $table) {
            $table->dropColumn(['price_euros', 'sort_order']);
        });
    }
};
