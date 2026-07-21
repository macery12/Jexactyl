<?php

namespace Everest\Http\Requests\Api\Client\Servers\Mods;

use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class GetDownloadQueueRequest extends ClientApiRequest
{
    public function permission(): string
    {
        // Listing the queue is read-only; gate it on file.read so subusers who can view
        // (but not create) files can still see in-flight downloads — matching the other
        // Get* mod endpoints.
        return Permission::ACTION_FILE_READ;
    }
}
