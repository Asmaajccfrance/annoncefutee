<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    protected $fillable = [
        'slug',
        'name',
        'monthly_credits',
        'analysis_cost',
        'stripe_price_id',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'monthly_credits' => 'integer',
            'analysis_cost' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public static function free(): self
    {
        return static::query()->firstOrCreate(
            ['slug' => 'free'],
            [
                'name' => 'Gratuit',
                'monthly_credits' => 30,
                'analysis_cost' => 1,
                'is_active' => true,
            ],
        );
    }
}
