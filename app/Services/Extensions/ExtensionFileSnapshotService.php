<?php

namespace Everest\Services\Extensions;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Support\Facades\Crypt;
use Everest\Models\ExtensionFileSnapshot;

class ExtensionFileSnapshotService
{
    /**
     * @param array<string, string> $fileContentsMap map of file path => plain text file contents
     */
    public function create(Server $server, string $extensionId, ?User $actor, string $action, array $fileContentsMap): ExtensionFileSnapshot
    {
        $encrypted = [];
        foreach ($fileContentsMap as $path => $contents) {
            $encrypted[$path] = Crypt::encryptString($contents);
        }

        return ExtensionFileSnapshot::query()->create([
            'server_id' => $server->id,
            'actor_id' => $actor?->id,
            'extension_id' => $extensionId,
            'action' => $action,
            'files' => $encrypted,
        ]);
    }

    /**
     * @return array<string, string> map of file path => decrypted contents
     */
    public function decryptFiles(ExtensionFileSnapshot $snapshot): array
    {
        $decrypted = [];
        foreach (($snapshot->files ?? []) as $path => $encrypted) {
            $decrypted[$path] = Crypt::decryptString($encrypted);
        }

        return $decrypted;
    }
}
