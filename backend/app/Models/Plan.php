<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    protected $fillable = [
        'slug',
        'name',
        'price_euros',
        'sort_order',
        'monthly_credits',
        'analysis_cost',
        'stripe_price_id',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'price_euros' => 'integer',
            'sort_order' => 'integer',
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
                'name' => 'Découverte',
                'price_euros' => 0,
                'sort_order' => 1,
                'monthly_credits' => 50,
                'analysis_cost' => 1,
                'is_active' => true,
            ],
        );
    }

    /**
     * @return Collection<int, self>
     */
    public static function catalog(): Collection
    {
        static::free();

        return static::query()
            ->orderBy('sort_order')
            ->orderBy('price_euros')
            ->orderBy('id')
            ->get();
    }

    /**
     * @return array<string, mixed>
     */
    public function toPublicArray(): array
    {
        $freeCredits = max(0, (int) config('credits.monthly_credits', 50));

        return [
            'slug' => $this->slug,
            'name' => $this->name,
            'price_euros' => (int) $this->price_euros,
            'monthly_credits' => $this->slug === 'free' ? $freeCredits : (int) $this->monthly_credits,
            'is_active' => (bool) $this->is_active,
            'is_free' => (int) $this->price_euros === 0,
        ];
    }
}
