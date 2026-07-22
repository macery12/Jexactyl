<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\Permission;
use Illuminate\Http\JsonResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Everest\Repositories\Wings\DaemonWingsRsRepository;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

class WingsRsController extends ClientApiController
{
    public function __construct(
        private DaemonWingsRsRepository $wingsRsRepository,
    ) {
        parent::__construct();
    }

    /**
     * GET /api/client/servers/{server}/supercharged — Check if server's node is Wings-RS.
     */
    public function status(Request $request, Server $server): JsonResponse
    {
        return new JsonResponse([
            'supercharged' => $server->node->isSupercharged(),
            'wings_type' => $server->node->wings_type,
            'wings_version' => $server->node->wings_version,
        ]);
    }

    /**
     * GET /api/client/servers/{server}/files/fingerprints — Get file checksums.
     */
    public function fingerprints(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_READ, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $request->validate([
            'files' => 'required|array|min:1|max:50',
            'files.*' => 'required|string|max:1024',
            'algorithm' => 'string|in:sha256,sha512,md5,blake3',
        ]);

        $data = $this->wingsRsRepository
            ->setServer($server)
            ->getFingerprints(
                $request->input('files'),
                $request->input('algorithm', 'sha256')
            );

        return new JsonResponse($data);
    }

    /**
     * POST /api/client/servers/{server}/files/search — Advanced file search.
     */
    public function searchFiles(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_READ, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $request->validate([
            'root' => 'nullable|string|max:1024',
            'per_page' => 'required|integer|min:1|max:100',
            'path_filter' => 'nullable|array',
            'path_filter.include' => 'required_with:path_filter|array|max:20',
            'path_filter.include.*' => 'string|max:512',
            'path_filter.exclude' => 'nullable|array|max:20',
            'path_filter.exclude.*' => 'string|max:512',
            'path_filter.case_insensitive' => 'nullable|boolean',
            'size_filter' => 'nullable|array',
            'size_filter.min' => 'nullable|integer|min:0',
            'size_filter.max' => 'required_with:size_filter|integer|min:0',
            'content_filter' => 'nullable|array',
            'content_filter.query' => 'required_with:content_filter|string|max:1024',
            'content_filter.max_search_size' => 'required_with:content_filter|integer|min:0|max:104857600',
            'content_filter.include_unmatched' => 'nullable|boolean',
            'content_filter.case_insensitive' => 'nullable|boolean',
        ]);

        $data = $this->wingsRsRepository
            ->setServer($server)
            ->searchFiles($request->only([
                'root', 'per_page', 'path_filter', 'size_filter', 'content_filter',
            ]));

        return new JsonResponse($data);
    }

    /**
     * POST /api/client/servers/{server}/files/compress-advanced — Compress with format selection.
     */
    public function compressAdvanced(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_ARCHIVE, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $request->validate([
            'root' => 'nullable|string|max:1024',
            'files' => 'required|array|min:1|max:200',
            'files.*' => 'required|string|max:1024',
            'format' => 'nullable|string|in:tar,tar_gz,tar_xz,tar_lzip,tar_bz2,tar_lz4,tar_zstd,zip,seven_zip',
            'name' => 'nullable|string|max:255',
            'foreground' => 'nullable|boolean',
        ]);

        $data = $this->wingsRsRepository
            ->setServer($server)
            ->compressFiles(
                $request->input('root'),
                $request->input('files'),
                $request->input('format'),
                $request->input('name'),
                $request->boolean('foreground', true)
            );

        return new JsonResponse($data, isset($data['identifier']) ? 202 : 200);
    }

    /**
     * DELETE /api/client/servers/{server}/files/operations/{operation} — Cancel operation.
     */
    public function cancelOperation(Request $request, Server $server, string $operation): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_UPDATE, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        // Validate that the operation ID is a safe UUID-like token before forwarding to the daemon.
        if (!preg_match('/^[a-zA-Z0-9\-]{1,64}$/', $operation)) {
            return new JsonResponse(['error' => 'Invalid operation identifier.'], 422);
        }

        $this->wingsRsRepository->setServer($server)->cancelOperation($operation);

        return new JsonResponse(['success' => true]);
    }

    /**
     * POST /api/client/servers/{server}/script — Run async script.
     *
     * Requires the dedicated script.run permission (not startup.update) because this
     * allows arbitrary container image selection and script execution — far beyond
     * editing startup environment variables.
     */
    public function runScript(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_SCRIPT_RUN, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $request->validate([
            'container_image' => 'required|string|max:191',
            'entrypoint' => 'required|string|max:191',
            'script' => 'required|string|max:65535',
            'environment' => 'nullable|array|max:50',
            'environment.*' => 'nullable|string|max:1024',
        ]);

        $data = $this->wingsRsRepository
            ->setServer($server)
            ->runScript(
                $request->input('container_image'),
                $request->input('entrypoint'),
                $request->input('script'),
                $request->input('environment', [])
            );

        return new JsonResponse($data);
    }

    /**
     * POST /api/client/servers/{server}/install/abort — Abort running installation.
     */
    public function abortInstall(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_SETTINGS_REINSTALL, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $this->wingsRsRepository->setServer($server)->abortInstall();

        return new JsonResponse(['success' => true], 202);
    }

    /**
     * GET /api/client/servers/{server}/logs/install — Get install logs.
     */
    public function installLogs(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_CONTROL_CONSOLE, $server)) {
            throw new AuthorizationException();
        }

        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'Feature requires a Supercharged node.'], 400);
        }

        $lines = (int) $request->query('lines', 100);
        $lines = max(1, min($lines, 5000));

        try {
            $content = $this->wingsRsRepository->setServer($server)->getInstallLogs($lines);
        } catch (DaemonConnectionException $exception) {
            if ($exception->getStatusCode() === 404) {
                return new JsonResponse(['content' => []]);
            }

            throw $exception;
        }

        return new JsonResponse(['content' => $content]);
    }

    /**
     * GET /api/client/servers/{server}/ssh — Get SSH connection instructions.
     */
    public function sshInfo(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_SFTP, $server)) {
            throw new AuthorizationException();
        }

        $node = $server->node;
        $user = $request->user();

        return new JsonResponse([
            'host' => $node->fqdn,
            'port' => $node->public_port_sftp,
            'username' => $user->username . '.' . $server->uuidShort,
            'command' => sprintf(
                'ssh %s.%s@%s -p %d',
                $user->username,
                $server->uuidShort,
                $node->fqdn,
                $node->public_port_sftp
            ),
            'supercharged' => $node->isSupercharged(),
            'shell_available' => $node->isSupercharged(),
            'shell_help_command' => '.wings help',
        ]);
    }
}
