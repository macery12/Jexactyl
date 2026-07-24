<?php

namespace Everest\Repositories\Wings;

use Everest\Models\Node;
use Everest\Models\Server;
use Webmozart\Assert\Assert;
use GuzzleHttp\Exception\TransferException;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

class DaemonWingsRsRepository extends DaemonRepository
{
    /**
     * Ensure the node is a Wings-RS (supercharged) node before making requests.
     *
     * @throws \RuntimeException
     */
    protected function assertSupercharged(): void
    {
        Assert::isInstanceOf($this->node, Node::class);

        if (!$this->node->isSupercharged()) {
            throw new \RuntimeException('This operation requires a Supercharged (Wings-RS) node.');
        }
    }

    // ─── System / Node-Level Endpoints ───────────────────────────────────

    /**
     * GET /api/system/overview — detailed system overview.
     */
    public function getSystemOverview(): array
    {
        $this->assertSupercharged();

        try {
            $response = $this->getHttpClient()->get('/api/system/overview');
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * GET /api/system/stats — real-time system statistics.
     */
    public function getSystemStats(): array
    {
        $this->assertSupercharged();

        try {
            $response = $this->getHttpClient()->get('/api/system/stats');
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * GET /api/system/logs — list log files.
     */
    public function getSystemLogs(): array
    {
        $this->assertSupercharged();

        try {
            $response = $this->getHttpClient()->get('/api/system/logs');
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * GET /api/system/logs/{file} — read a specific log file.
     */
    public function getSystemLogContents(string $file, ?int $lines = null): string
    {
        $this->assertSupercharged();

        try {
            $params = [];
            if ($lines !== null) {
                $params['lines'] = $lines;
            }

            $response = $this->getHttpClient()->get(
                sprintf('/api/system/logs/%s', rawurlencode($file)),
                ['query' => $params]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return $response->getBody()->__toString();
    }

    /**
     * POST /api/system/upgrade — trigger Wings-RS self-upgrade.
     *
     * The daemon requires all five fields — its Payload struct has no serde
     * defaults, so omitting any of them fails deserialization before the
     * upgrade is even attempted. It then spawns `restart_command` verbatim,
     * which is why the command and the download headers come from server-side
     * config instead of the API request: callers must not be able to turn this
     * endpoint into arbitrary command execution on the node.
     */
    public function upgradeSystem(string $url, string $sha256): void
    {
        $this->assertSupercharged();

        try {
            $this->getHttpClient()->post('/api/system/upgrade', [
                'json' => [
                    'url' => $url,
                    // No extra download headers: the binary URL must be publicly
                    // fetchable. Sent explicitly because the field is required.
                    'headers' => (object) [],
                    'sha256' => $sha256,
                    'restart_command' => config('everest.wings_rs.restart_command'),
                    'restart_command_args' => array_values(
                        config('everest.wings_rs.restart_command_args')
                    ),
                ],
            ]);
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    // ─── File Manager Enhancements ───────────────────────────────────────

    /**
     * GET /api/servers/{server}/files/list — paginated file listing (Wings-RS enhanced).
     */
    public function getFileList(string $directory, array $ignored = [], int $perPage = 100, int $page = 1): array
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        // `ignored` is a repeated query key (ignored=a&ignored=b) on the daemon;
        // Guzzle's array serialization (ignored[0]=a) is silently dropped, so
        // build the string by hand — see getFingerprints for the same fix.
        $query = http_build_query([
            'directory' => $directory,
            'per_page' => $perPage,
            'page' => $page,
        ], '', '&', PHP_QUERY_RFC3986);
        foreach (array_values($ignored) as $pattern) {
            $query .= '&ignored=' . rawurlencode($pattern);
        }

        try {
            $response = $this->getHttpClient()->get(
                sprintf('/api/servers/%s/files/list', $this->server->uuid),
                ['query' => $query]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * GET /api/servers/{server}/files/fingerprints — file checksums.
     */
    public function getFingerprints(array $files, string $algorithm = 'sha256'): array
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        // The daemon parses `files` as a repeated query key (files=a&files=b).
        // Guzzle would serialize a PHP array as files[0]=a&files[1]=b, which the
        // daemon's Vec<String> extractor ignores, so build the string by hand.
        $query = 'algorithm=' . rawurlencode($algorithm);
        foreach (array_values($files) as $file) {
            $query .= '&files=' . rawurlencode($file);
        }

        try {
            $response = $this->getHttpClient()->get(
                sprintf('/api/servers/%s/files/fingerprints', $this->server->uuid),
                ['query' => $query]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * POST /api/servers/{server}/files/search — advanced file search.
     */
    public function searchFiles(array $params): array
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $response = $this->getHttpClient()->post(
                sprintf('/api/servers/%s/files/search', $this->server->uuid),
                ['json' => $params]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * POST /api/servers/{server}/files/compress — advanced compress with format and progress.
     */
    public function compressFiles(?string $root, array $files, ?string $format = null, ?string $name = null, bool $foreground = true): array
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        $payload = [
            'root' => $root ?? '/',
            'files' => $files,
            'foreground' => $foreground,
        ];

        if ($format !== null) {
            $payload['format'] = $format;
        }
        if ($name !== null) {
            $payload['name'] = $name;
        }

        try {
            $response = $this->getHttpClient()->post(
                sprintf('/api/servers/%s/files/compress', $this->server->uuid),
                [
                    'json' => $payload,
                    'timeout' => $foreground ? 60 * 15 : 30,
                ]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * DELETE /api/servers/{server}/files/operations/{operation} — cancel a running operation.
     */
    public function cancelOperation(string $operationId): void
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $this->getHttpClient()->delete(
                sprintf('/api/servers/%s/files/operations/%s', $this->server->uuid, $operationId)
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    // ─── Server Scripts ──────────────────────────────────────────────────

    /**
     * POST /api/servers/{server}/script — run async scripts.
     */
    public function runScript(string $containerImage, string $entrypoint, string $script, array $environment = []): array
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        $payload = [
            'container_image' => $containerImage,
            'entrypoint' => $entrypoint,
            'script' => $script,
        ];

        if (!empty($environment)) {
            $payload['environment'] = $environment;
        }

        try {
            $response = $this->getHttpClient()->post(
                sprintf('/api/servers/%s/script', $this->server->uuid),
                ['json' => $payload, 'timeout' => 60 * 30]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }

    /**
     * POST /api/servers/{server}/install/abort — abort a running installation.
     */
    public function abortInstall(): void
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $this->getHttpClient()->post(
                sprintf('/api/servers/%s/install/abort', $this->server->uuid)
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    /**
     * GET /api/servers/{server}/logs/install — get install logs.
     */
    public function getInstallLogs(?int $lines = 100): string
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $params = [];
            if ($lines !== null) {
                $params['lines'] = $lines;
            }

            $response = $this->getHttpClient()->get(
                sprintf('/api/servers/%s/logs/install', $this->server->uuid),
                ['query' => $params]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return $response->getBody()->__toString();
    }

    /**
     * GET /api/servers/{server}/logs — get server logs from Wings-RS.
     */
    public function getServerLogs(?int $lines = 100): string
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $params = [];
            if ($lines !== null) {
                $params['lines'] = $lines;
            }

            $response = $this->getHttpClient()->get(
                sprintf('/api/servers/%s/logs', $this->server->uuid),
                ['query' => $params]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return $response->getBody()->__toString();
    }

    // ─── WebSocket Enhancements ──────────────────────────────────────────

    /**
     * POST /api/servers/{server}/ws/permissions — live permission updates.
     */
    public function updateWsPermissions(array $userPermissions): void
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $this->getHttpClient()->post(
                sprintf('/api/servers/%s/ws/permissions', $this->server->uuid),
                ['json' => ['user_permissions' => $userPermissions]]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    /**
     * POST /api/servers/{server}/ws/broadcast — broadcast message to connected users.
     */
    public function broadcastMessage(array $users, array $permissions, string $event, array $args = []): void
    {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        try {
            $this->getHttpClient()->post(
                sprintf('/api/servers/%s/ws/broadcast', $this->server->uuid),
                [
                    'json' => [
                        'users' => $users,
                        'permissions' => $permissions,
                        'message' => [
                            'event' => $event,
                            'args' => $args,
                        ],
                    ],
                ]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    // ─── Transfer Enhancements ───────────────────────────────────────────

    /**
     * POST /api/servers/{server}/transfer — enhanced transfer with archive format options.
     */
    public function initiateTransfer(
        string $url,
        string $token,
        ?string $archiveFormat = null,
        ?string $compressionLevel = null,
        array $backups = [],
        bool $deleteBackups = false,
        int $multiplexStreams = 0,
    ): void {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        $payload = [
            'url' => $url,
            'token' => $token,
        ];

        if ($archiveFormat !== null) {
            $payload['archive_format'] = $archiveFormat;
        }
        if ($compressionLevel !== null) {
            $payload['compression_level'] = $compressionLevel;
        }
        if (!empty($backups)) {
            $payload['backups'] = $backups;
        }
        if ($deleteBackups) {
            $payload['delete_backups'] = true;
        }
        if ($multiplexStreams > 0) {
            $payload['multiplex_streams'] = $multiplexStreams;
        }

        try {
            $this->getHttpClient()->post(
                sprintf('/api/servers/%s/transfer', $this->server->uuid),
                ['json' => $payload]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }
    }

    // ─── File Copy Remote ────────────────────────────────────────────────

    /**
     * POST /api/servers/{server}/files/copy-remote — copy files to another node.
     */
    public function copyRemote(
        string $url,
        string $token,
        array $files,
        string $destinationServer,
        string $destinationPath,
        ?string $root = null,
        ?string $archiveFormat = null,
        ?string $compressionLevel = null,
        bool $foreground = true,
    ): array {
        $this->assertSupercharged();
        Assert::isInstanceOf($this->server, Server::class);

        $payload = [
            'url' => $url,
            'token' => $token,
            'files' => $files,
            'destination_server' => $destinationServer,
            'destination_path' => $destinationPath,
            'foreground' => $foreground,
        ];

        if ($root !== null) {
            $payload['root'] = $root;
        }
        if ($archiveFormat !== null) {
            $payload['archive_format'] = $archiveFormat;
        }
        if ($compressionLevel !== null) {
            $payload['compression_level'] = $compressionLevel;
        }

        try {
            $response = $this->getHttpClient()->post(
                sprintf('/api/servers/%s/files/copy-remote', $this->server->uuid),
                ['json' => $payload, 'timeout' => $foreground ? 60 * 15 : 30]
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        return json_decode($response->getBody()->__toString(), true);
    }
}
