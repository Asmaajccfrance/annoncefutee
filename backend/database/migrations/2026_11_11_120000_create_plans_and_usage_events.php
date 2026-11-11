<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->unsignedInteger('monthly_credits');
            $table->unsignedInteger('analysis_cost')->default(1);
            $table->string('stripe_price_id')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable()->after('id')->constrained('plans')->nullOnDelete();
        });

        Schema::create('usage_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('operation', 64);
            $table->string('status', 32);
            $table->unsignedInteger('credits_charged')->default(0);
            $table->unsignedInteger('prompt_tokens')->nullable();
            $table->unsignedInteger('completion_tokens')->nullable();
            $table->unsignedBigInteger('estimated_cost_micros')->default(0);
            $table->string('model', 80)->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->string('error_code', 64)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index('created_at');
        });

        $now = now();
        DB::table('plans')->insert([
            'slug' => 'free',
            'name' => 'Gratuit',
            'monthly_credits' => 30,
            'analysis_cost' => 1,
            'stripe_price_id' => null,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_events');
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_id');
        });
        Schema::dropIfExists('plans');
    }
};
