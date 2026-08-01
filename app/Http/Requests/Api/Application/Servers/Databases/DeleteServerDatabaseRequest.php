<?php

namespace Everest\Http\Requests\Api\Application\Servers\Databases;

use Everest\Models\AdminRole;

class DeleteServerDatabaseRequest extends ServerDatabaseWriteRequest
{
    public function permission(): string
    {
        return AdminRole::SERVER_DATABASES_DELETE;
    }
}
