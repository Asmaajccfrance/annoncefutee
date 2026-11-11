<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('credit_guards', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
        });

        DB::table('credit_guards')->insert(['id' => 1]);

        Schema::table('usage_events', function (Blueprint $table) {
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('usage_events', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'status']);
        });

        Schema::dropIfExists('credit_guards');
    }
};
