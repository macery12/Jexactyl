<?php

namespace Everest\Http\Middleware\Api\Daemon;

use Everest\Models\Backup;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Everest\Services\Servers\DaemonServerAuthorizationService;

class DaemonBackupAuthorization
{
    public const BACKUP_ATTRIBUTE = 'daemon_backup';

    public function __construct(private DaemonServerAuthorizationService $authorization)
    {
    }

    /**
     * Resolve and authorize the backup before controller arguments (including
     * form requests) are validated.
     */
    public function handle(Request $request, \Closure $next): Response
    {
        /** @var Backup $backup */
        $backup = Backup::query()
            ->with('server')
            ->where('uuid', (string) $request->route('backup'))
            ->firstOrFail();

        $this->authorization->assertCanAccessBackup($this->authorization->node($request), $backup);
        $request->attributes->set(self::BACKUP_ATTRIBUTE, $backup);

        return $next($request);
    }
}
