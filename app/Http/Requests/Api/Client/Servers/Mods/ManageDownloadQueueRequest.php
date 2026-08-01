<?php

namespace Everest\Http\Requests\Api\Client\Servers\Mods;

use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

/**
 * Queue cleanup never writes a daemon path, so it retains the historical
 * file.create capability while download and retry actions use the stricter
 * overwrite-capable request.
 */
class ManageDownloadQueueRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }
}
