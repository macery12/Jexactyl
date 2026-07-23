<?php

namespace Everest\Models\Billing;

use Everest\Models\Egg;
use Everest\Models\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property string $uuid
 * @property string $name
 * @property string $icon
 * @property string $description
 * @property bool $visible
 * @property int $nest_id
 * @property int $egg_id
 * @property array $allowed_eggs
 * @property bool $allow_egg_changes
 * @property bool $allow_plan_changes
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class Category extends Model
{
    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'category';

    /**
     * The table associated with the model.
     */
    protected $table = 'categories';

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'uuid', 'name', 'visible', 'icon',
        'description', 'nest_id', 'egg_id',
        'allowed_eggs', 'allow_egg_changes', 'allow_plan_changes',
    ];

    public static array $validationRules = [
        'uuid' => 'required|string|size:36',
        'name' => 'required|string|min:3|max:191',
        'icon' => 'nullable|string|max:300',
        'description' => 'nullable|string|max:300',
        'visible' => 'nullable|bool',
        'nest_id' => 'required|exists:nests,id',
        'egg_id' => 'required|exists:eggs,id',
        'allowed_eggs' => 'nullable|array',
        'allowed_eggs.*' => 'integer|exists:eggs,id',
        'allow_egg_changes' => 'nullable|bool',
        'allow_plan_changes' => 'nullable|bool',
    ];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'allowed_eggs' => 'array',
        'allow_egg_changes' => 'boolean',
        'allow_plan_changes' => 'boolean',
    ];

    public function products(): HasMany
    {
        return $this->hasMany(Product::class, 'category_uuid');
    }

    /**
     * Get the allowed eggs for this category with fallback to single egg for backward compatibility.
     */
    public function getAllowedEggs(): array
    {
        $allowedEggs = $this->allowed_eggs;

        if (empty($allowedEggs)) {
            $allowedEggs = [$this->egg_id];
        }

        // Return the concrete IDs the client needs to display, after pruning any missing eggs.
        // This list is intentionally materialized here because the allowed egg set is small and required by the client.
        $existingEggs = Egg::query()
            ->whereIn('id', $allowedEggs)
            ->pluck('id')
            ->all();

        if (empty($existingEggs)) {
            // Fallback to the legacy single egg_id if it still exists.
            $defaultEgg = Egg::query()->find($this->egg_id);
            $existingEggs = $defaultEgg ? [$defaultEgg->id] : [];
        }

        return $existingEggs;
    }

    /**
     * Get the default egg ID for this category (first allowed egg).
     */
    public function getDefaultEggId(): int
    {
        $allowedEggs = $this->getAllowedEggs();

        return $allowedEggs[0] ?? $this->egg_id;
    }
}
