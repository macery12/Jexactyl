<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\User;
use Everest\Models\Database;
use Everest\Models\AdminRole;
use League\Fractal\Resource\Item;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Transformers\Api\Transformer;
use League\Fractal\Resource\NullResource;
use Illuminate\Contracts\Encryption\Encrypter;

class ServerDatabaseTransformer extends Transformer
{
    protected array $availableIncludes = ['host', 'password'];

    private Encrypter $encrypter;

    /**
     * Perform dependency injection.
     */
    public function handle(Encrypter $encrypter)
    {
        $this->encrypter = $encrypter;
    }

    /**
     * Return the resource name for the JSONAPI output.
     */
    public function getResourceName(): string
    {
        return Database::RESOURCE_NAME;
    }

    /**
     * Transform a database model in a representation for the application API.
     */
    public function transform(Database $model): array
    {
        return [
            'id' => $model->id,
            'database_host_id' => $model->database_host_id,
            'server_id' => $model->server_id,
            'name' => $model->database,
            'username' => $model->username,
            'remote' => $model->remote,
            'max_connections' => $model->max_connections,
            'created_at' => $model->created_at->toIso8601String(),
            'updated_at' => $model->updated_at->toIso8601String(),
        ];
    }

    /**
     * Return the database host relationship for this server database.
     */
    public function includeHost(Database $model): Item|NullResource
    {
        if (!$this->authorize(AdminAcl::RESOURCE_DATABASE_HOSTS)) {
            return $this->null();
        }

        return $this->item($model->host, new DatabaseHostTransformer());
    }

    /**
     * Include the database password in the request.
     */
    public function includePassword(Database $model): Item|NullResource
    {
        if (!$this->canViewPassword()) {
            return $this->null();
        }

        return $this->item($model, function (Database $model) {
            return [
                'password' => $this->encrypter->decrypt($model->password),
            ];
        });
    }

    /**
     * Gate the decrypted credential explicitly against the admin role system rather
     * than riding on Transformer::authorize()/the include ACL. A decrypted password is
     * far more sensitive than the rest of the resource, so it keeps its own dedicated
     * `databases.read` check that a future change to the include-permission map cannot
     * loosen.
     *
     * `servers.read` -- all that GetServerDatabasesRequest needs to reach this
     * transformer -- is deliberately not sufficient: it would let any role that can
     * list servers dump every database password on the panel via
     * `?include=databases.password`.
     */
    private function canViewPassword(): bool
    {
        $user = $this->request->user();

        if (!$user instanceof User) {
            return false;
        }

        if ($user->root_admin) {
            return true;
        }

        if (!$user->admin_role_id) {
            return false;
        }

        return in_array(AdminRole::DATABASES_READ, AdminRole::find($user->admin_role_id)->permissions ?? [], true);
    }
}
