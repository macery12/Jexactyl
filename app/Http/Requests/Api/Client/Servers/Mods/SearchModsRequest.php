<?php

namespace Everest\Http\Requests\Api\Client\Servers\Mods;

use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class SearchModsRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function rules(): array
    {
        return [
            'searchFilter' => 'nullable|string|max:255',
            'sortField' => 'nullable|string|max:50', // Allow provider-specific sort keys
            'sortOrder' => 'nullable|string|in:asc,desc',
            'gameVersion' => 'nullable|string|max:50',
            'modLoaderType' => 'nullable|integer|min:0', // Numeric mod loader type (forge=1, fabric=4, quilt=5, neoforge=6)
            'pageSize' => 'nullable|integer|min:1|max:50',
            'index' => 'nullable|integer|min:0',
            'categoryId' => 'nullable|integer|min:0',
            'minRating' => 'nullable|numeric|min:0|max:5',
            'resource' => 'nullable|string|in:mods,plugins',
            'platform' => 'nullable',
            'platform.*' => 'string|max:50',
        ];
    }
}
