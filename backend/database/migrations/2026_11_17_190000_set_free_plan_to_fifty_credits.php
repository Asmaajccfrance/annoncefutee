<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('plans')->where('slug', 'free')->update([
            'name' => 'Découverte',
            'monthly_credits' => 50,
            'is_active' => true,
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('plans')->where('slug', 'free')->update([
            'monthly_credits' => 30,
            'updated_at' => now(),
        ]);
    }
};
