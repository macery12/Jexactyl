<?php

namespace Everest\Http\Controllers\Api\Client\Extensions;

use Everest\Models\Server;
use Everest\Models\Subuser;
use Illuminate\Support\Arr;
use Symfony\Component\Yaml\Yaml;
use Illuminate\Http\JsonResponse;
use Everest\Models\ExtensionConfig;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\ResponseInterface;
use Everest\Models\ExtensionFileSnapshot;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Services\Extensions\ExtensionFileSnapshotService;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperOwnerRequest;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperTokenRequest;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperStatusRequest;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperChannelRequest;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperInstallRequest;
use Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper\DiscordSrvHelperSubuserAccessRequest;

class DiscordSrvHelperController extends ClientApiController
{
    private const EXTENSION_ID = 'discordsrv_helper';
    private const PLUGINS_DIR = '/plugins';
    private const DISCORDSRV_DIR = '/plugins/DiscordSRV';
    private const CONFIG_FILE = '/plugins/DiscordSRV/config.yml';
    private const TOKEN_FILE = '/plugins/DiscordSRV/.token';
    private const JAR_FILENAME = 'DiscordSRV.jar';

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private ExtensionFileSnapshotService $snapshotService,
    ) {
        parent::__construct();
    }

    public function status(DiscordSrvHelperStatusRequest $request, Server $server): JsonResponse
    {
        $plugins = $this->fileRepository->setServer($server)->getDirectory(self::PLUGINS_DIR);

        $pluginJar = null;
        $hasDiscordSrvFolder = false;

        foreach ($plugins as $item) {
            $name = (string) Arr::get($item, 'name', '');
            $isFile = (bool) Arr::get($item, 'file', true);

            if (!$isFile && $name === 'DiscordSRV') {
                $hasDiscordSrvFolder = true;
            }

            if ($isFile && str_ends_with(strtolower($name), '.jar') && str_contains($name, 'DiscordSRV')) {
                $pluginJar = $name;
            }
        }

        $tokenPresent = false;
        $configPresent = false;

        if ($hasDiscordSrvFolder) {
            $discordSrvDir = $this->fileRepository->setServer($server)->getDirectory(self::DISCORDSRV_DIR);
            foreach ($discordSrvDir as $item) {
                $name = (string) Arr::get($item, 'name', '');
                $isFile = (bool) Arr::get($item, 'file', true);

                if ($isFile && $name === '.token') {
                    $tokenPresent = true;
                }
                if ($isFile && $name === 'config.yml') {
                    $configPresent = true;
                }
            }
        }

        return new JsonResponse([
            'installed' => !is_null($pluginJar),
            'plugin_jar' => $pluginJar,
            'plugin_folder_present' => $hasDiscordSrvFolder,
            'token_file_present' => $tokenPresent,
            'config_present' => $configPresent,
        ]);
    }

    public function install(DiscordSrvHelperInstallRequest $request, Server $server): JsonResponse
    {
        $jarUrl = $request->input('jar_url');
        if (!$jarUrl) {
            $config = ExtensionConfig::getByExtensionId(self::EXTENSION_ID);
            $jarUrl = is_array($config?->settings) ? Arr::get($config->settings, 'jar_url') : null;
        }
        if (!$jarUrl) {
            $jarUrl = $this->getLatestDiscordSrvJarUrl();
        }

        $jarUrl = $this->resolveRedirectedUrl($jarUrl);

        $response = $this->fileRepository->setServer($server)->pull($jarUrl, self::PLUGINS_DIR, [
            'filename' => self::JAR_FILENAME,
            'foreground' => true,
        ]);

        $this->ensureDaemonSuccess($response, 'Failed to download DiscordSRV jar.');

        return new JsonResponse([
            'installed' => true,
            'jar' => self::JAR_FILENAME,
            'jar_url' => $jarUrl,
        ]);
    }

    private function ensureDaemonSuccess(ResponseInterface $response, string $message): void
    {
        $status = $response->getStatusCode();
        if ($status >= 200 && $status < 300) {
            return;
        }

        $body = trim((string) $response->getBody());
        throw new \RuntimeException($message . ($body ? " Wings response: {$body}" : ''));
    }

    public function setToken(DiscordSrvHelperTokenRequest $request, Server $server): JsonResponse
    {
        $token = trim((string) $request->input('token'));

        $this->ensureDirectory($server, self::PLUGINS_DIR, 'DiscordSRV');

        $before = $this->safeGetContent($server, self::TOKEN_FILE);
        if (!is_null($before)) {
            $this->snapshotService->create($server, self::EXTENSION_ID, $request->user(), 'set-token', [
                self::TOKEN_FILE => $before,
            ]);
        }

        $this->fileRepository->setServer($server)->putContent(self::TOKEN_FILE, $token);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    public function setGlobalChannel(DiscordSrvHelperChannelRequest $request, Server $server): JsonResponse
    {
        $channelId = (string) $request->input('channel_id');

        $before = $this->safeGetContent($server, self::CONFIG_FILE);
        if (is_null($before)) {
            return new JsonResponse([
                'error' => 'DiscordSRV config.yml was not found. Start the server once to let DiscordSRV generate its config, then try again.',
            ], 409);
        }

        $this->snapshotService->create($server, self::EXTENSION_ID, $request->user(), 'set-global-channel', [
            self::CONFIG_FILE => $before,
        ]);

        try {
            $config = Yaml::parse($before);
        } catch (\Throwable $exception) {
            return new JsonResponse([
                'error' => 'DiscordSRV config.yml could not be parsed as YAML. Use the revert feature or fix the file manually, then try again.',
            ], 422);
        }
        if (!is_array($config)) {
            $config = [];
        }

        $channels = Arr::get($config, 'Channels', []);
        if (!is_array($channels)) {
            $channels = [];
        }

        $channels['global'] = $channelId;
        $config['Channels'] = $channels;

        $yaml = Yaml::dump($config, 20, 2);
        if (!str_ends_with($yaml, "\n")) {
            $yaml .= "\n";
        }

        $this->fileRepository->setServer($server)->putContent(self::CONFIG_FILE, $yaml);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    public function history(DiscordSrvHelperOwnerRequest $request, Server $server): JsonResponse
    {
        $snapshots = ExtensionFileSnapshot::query()
            ->where('server_id', $server->id)
            ->where('extension_id', self::EXTENSION_ID)
            ->with('actor')
            ->orderByDesc('id')
            ->limit(25)
            ->get();

        $data = $snapshots->map(fn (ExtensionFileSnapshot $s) => [
            'id' => $s->id,
            'action' => $s->action,
            'created_at' => $s->created_at,
            'actor' => $s->actor ? [
                'id' => $s->actor->id,
                'email' => $s->actor->email,
            ] : null,
        ])->values();

        return new JsonResponse([
            'object' => 'list',
            'data' => $data,
        ]);
    }

    public function revert(DiscordSrvHelperOwnerRequest $request, Server $server, int $snapshotId): JsonResponse
    {
        $snapshot = ExtensionFileSnapshot::query()
            ->where('server_id', $server->id)
            ->where('extension_id', self::EXTENSION_ID)
            ->where('id', $snapshotId)
            ->firstOrFail();

        $files = $this->snapshotService->decryptFiles($snapshot);
        foreach ($files as $path => $contents) {
            $this->fileRepository->setServer($server)->putContent($path, $contents);
        }

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    public function subusers(DiscordSrvHelperOwnerRequest $request, Server $server): JsonResponse
    {
        $subusers = Subuser::query()
            ->with('user')
            ->where('server_id', $server->id)
            ->get();

        $data = $subusers->map(fn (Subuser $s) => [
            'uuid' => $s->user->uuid,
            'email' => $s->user->email,
            'username' => $s->user->username,
            'disabled' => in_array(self::EXTENSION_ID, $s->disabled_extensions ?? [], true),
        ])->values();

        return new JsonResponse([
            'object' => 'list',
            'data' => $data,
        ]);
    }

    public function setSubuserAccess(DiscordSrvHelperSubuserAccessRequest $request, Server $server, string $subuserUuid): JsonResponse
    {
        $enabled = (bool) $request->input('enabled');

        $subuser = Subuser::query()
            ->where('server_id', $server->id)
            ->whereHas('user', fn ($q) => $q->where('uuid', $subuserUuid))
            ->firstOrFail();

        $disabled = $subuser->disabled_extensions ?? [];
        $disabled = array_values(array_unique(array_filter($disabled, 'is_string')));

        if ($enabled) {
            $disabled = array_values(array_filter($disabled, fn ($id) => $id !== self::EXTENSION_ID));
        } else {
            if (!in_array(self::EXTENSION_ID, $disabled, true)) {
                $disabled[] = self::EXTENSION_ID;
            }
        }

        $subuser->update(['disabled_extensions' => $disabled]);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    private function ensureDirectory(Server $server, string $path, string $name): void
    {
        try {
            $this->fileRepository->setServer($server)->createDirectory($name, $path);
        } catch (\Throwable) {
            // Directory likely already exists; ignore.
        }
    }

    private function safeGetContent(Server $server, string $file): ?string
    {
        try {
            return $this->fileRepository->setServer($server)->getContent($file);
        } catch (\Throwable) {
            return null;
        }
    }

    private function getLatestDiscordSrvJarUrl(): string
    {
        $response = Http::timeout(15)
            ->withHeaders([
                'Accept' => 'application/vnd.github+json',
            ])
            ->get('https://api.github.com/repos/DiscordSRV/DiscordSRV/releases/latest');

        $response->throw();
        $json = $response->json();

        $assets = $json['assets'] ?? [];
        foreach ($assets as $asset) {
            $name = (string) ($asset['name'] ?? '');
            $url = (string) ($asset['browser_download_url'] ?? '');

            if ($url && str_ends_with(strtolower($name), '.jar')) {
                return $url;
            }
        }

        throw new \RuntimeException('Could not locate a .jar asset in the latest DiscordSRV release.');
    }

    private function resolveRedirectedUrl(string $url): string
    {
        try {
            $response = Http::timeout(15)
                ->withOptions([
                    'allow_redirects' => [
                        'track_redirects' => true,
                    ],
                ])
                ->head($url);

            $headers = $response->headers();
            $history = $headers['X-Guzzle-Redirect-History'] ?? [];

            if (is_string($history)) {
                $history = array_filter(array_map('trim', explode(',', $history)));
            }

            if (is_array($history) && count($history) > 0) {
                $last = (string) $history[count($history) - 1];
                if ($last !== '') {
                    return $last;
                }
            }

            return $url;
        } catch (\Throwable) {
            return $url;
        }
    }
}
