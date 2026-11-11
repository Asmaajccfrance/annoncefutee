<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UsageEvent extends Model
{
    protected $fillable = [
        'user_id',
        'operation',
        'status',
        'credits_charged',
        'prompt_tokens',
        'completion_tokens',
        'estimated_cost_micros',
        'model',
        'duration_ms',
        'error_code',
    ];

    protected function casts(): array
    {
        return [
            'credits_charged' => 'integer',
            'prompt_tokens' => 'integer',
            'completion_tokens' => 'integer',
            'estimated_cost_micros' => 'integer',
            'duration_ms' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
