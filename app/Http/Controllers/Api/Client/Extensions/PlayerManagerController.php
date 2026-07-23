<?php

namespace Everest\Http\Controllers\Api\Client\Extensions;

use Everest\Models\Server;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Models\ExtensionConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Repositories\Wings\DaemonCommandRepository;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Services\Extensions\MinecraftPlayerManager\NbtParser;
use Everest\Services\Extensions\MinecraftPlayerManager\MinecraftPing;
use Everest\Services\Extensions\MinecraftPlayerManager\MinecraftQuery;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\IpRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\BanRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\KickRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\BanIpRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\PlayerRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\WhisperRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\AttributeRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\GetStatusRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\PlayerReadRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\PlayerNamedRequest;
use Everest\Http\Requests\Api\Client\Extensions\PlayerManager\SetWhitelistRequest;

class PlayerManagerController extends ClientApiController
{
    public function __construct(
        private DaemonFileRepository $fileRepository,
        private DaemonCommandRepository $commandRepository,
    ) {
        parent::__construct();
    }

    /**
     * Sanitize player name to prevent command injection.
     * Minecraft usernames can only be 3-16 characters, alphanumeric and underscore.
     */
    private function sanitizePlayerName(string $name): string
    {
        // Remove any characters that aren't alphanumeric or underscore
        $sanitized = preg_replace('/[^a-zA-Z0-9_]/', '', $name);

        // Ensure length is between 3 and 16 characters
        if (strlen($sanitized) < 3 || strlen($sanitized) > 16) {
            throw new \InvalidArgumentException('Invalid player name format');
        }

        return $sanitized;
    }

    /**
     * Validate and sanitize IP address.
     */
    private function sanitizeIpAddress(string $ip): string
    {
        // Validate as IPv4 or IPv6
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            throw new \InvalidArgumentException('Invalid IP address format');
        }

        return $ip;
    }

    /**
     * Sanitize reason/message to prevent command injection.
     */
    private function sanitizeMessage(string $message): string
    {
        // Remove newlines and limit length
        $sanitized = str_replace(["\r", "\n", "\t"], ' ', $message);

        return substr(trim($sanitized), 0, 255);
    }

    /**
     * Check if the extension is enabled for this server.
     */
    private function checkExtensionEnabled(Server $server): void
    {
        $config = ExtensionConfig::getByExtensionId('minecraft_player_manager');

        if (!$config || !$config->isServerEligible($server)) {
            throw new \Exception('Minecraft Player Manager is not enabled for this server.');
        }
    }

    private function queryApi(Server $server): array
    {
        return Cache::remember("minecraftserver:query:{$server->id}", 10, function () use ($server) {
            if ($this->isQueryEnabled($server)) {
                $query = new MinecraftQuery();
                $query->Connect($server->allocation->alias ?? $server->allocation->ip, $server->allocation->port, 2, false);

                $data = $query->GetInfo();

                if (!$data) {
                    throw new \Exception('Failed to query server');
                }

                $players = [];
                $rawPlayers = $query->GetPlayers();
                if ($rawPlayers) {
                    foreach ($rawPlayers as $player) {
                        $userData = $this->lookupUserName($player, $server);

                        $uuid = $userData['uuid'] ?? null;
                        if (!$uuid) {
                            continue;
                        }

                        $players[] = [
                            'id' => $uuid,
                            'name' => $player,
                        ];
                    }
                }

                return [
                    'players' => [
                        'online' => $data['Players'],
                        'max' => $data['MaxPlayers'],
                        'list' => $players,
                    ],
                ];
            }
            $query = new MinecraftPing($server->allocation->alias ?? $server->allocation->ip, $server->allocation->port, 2, false);
            $query->Connect();

            $data = $query->Query();

            if (!$data) {
                throw new \Exception('Failed to query server');
            }

            return [
                'players' => [
                    'online' => $data['players']['online'],
                    'max' => $data['players']['max'],
                    'list' => $data['players']['sample'] ?? [],
                ],
            ];

        });
    }

    private function userCache(Server $server): array
    {
        return Cache::remember("minecraftserver:username-cache:{$server->id}", 30, function () use ($server) {
            try {
                $cache = $this->fileRepository->setServer($server)->getContent('/usercache.json');

                return json_decode($cache, true) ?? [];
            } catch (\Throwable $e) {
                return [];
            }
        });
    }

    private function formatUuid(string $uuid): string
    {
        $uuid = str_replace('-', '', $uuid);

        return substr($uuid, 0, 8) . '-' . substr($uuid, 8, 4) . '-' . substr($uuid, 12, 4) . '-' . substr($uuid, 16, 4) . '-' . substr($uuid, 20);
    }

    private function lookupUserName(string $name, Server $server): ?array
    {
        $app = config('app.name', 'M12Labs');
        $offline = $this->isOfflineMode($server);
        $cache = $this->userCache($server);

        foreach ($cache as $player) {
            if ($player['name'] === $name) {
                return [
                    'uuid' => $this->formatUuid($player['uuid']),
                    'name' => $player['name'],
                ];
            }
        }

        if ($offline) {
            $uuid = $this->formatUuid(md5("OfflinePlayer:$name"));

            return [
                'uuid' => $uuid,
                'name' => $name,
            ];
        }

        $data = Cache::remember("minecraftplayername:$name", 1000, function () use ($app, $name) {
            try {
                $req = Http::withUserAgent("M12Labs Player Manager @ $app")
                    ->timeout(5)
                    ->retry(2, 100, throw: true)
                    ->get("https://api.mojang.com/users/profiles/minecraft/$name");

                return json_decode($req->body(), true);
            } catch (\Throwable $e) {
                return null;
            }
        });

        if (is_null($data)) {
            return null;
        }

        return [
            'uuid' => $this->formatUuid($data['id']),
            'name' => $data['name'],
        ];
    }

    private function sortList(array $list): array
    {
        usort($list, function ($a, $b) {
            return strcasecmp($a['name'] ?? $a['ip'], $b['name'] ?? $b['ip']);
        });

        return $list;
    }

    private function getServerProperties(Server $server): array
    {
        return Cache::remember("minecraftserver:properties:{$server->id}", 10, function () use ($server) {
            try {
                $properties = $this->fileRepository->setServer($server)->getContent('/server.properties');
                $data = explode("\n", $properties);

                $result = [];
                foreach ($data as $line) {
                    if (str_starts_with($line, '#')) {
                        continue;
                    }

                    $parts = explode('=', $line, 2);
                    $result[$parts[0]] = $parts[1] ?? '';
                }

                return $result;
            } catch (\Throwable $e) {
                return [];
            }
        });
    }

    private function isQueryEnabled(Server $server): bool
    {
        $properties = $this->getServerProperties($server);

        if (array_key_exists('enable-query', $properties) && $properties['enable-query'] === 'true') {
            return true;
        }

        return false;
    }

    private function isOfflineMode(Server $server): bool
    {
        $properties = $this->getServerProperties($server);

        if (array_key_exists('online-mode', $properties) && $properties['online-mode'] === 'false') {
            return true;
        }

        return false;
    }

    private function isBukkitBased(Server $server): bool
    {
        return Cache::remember("minecraftserver:bukkit:{$server->id}", 30, function () use ($server) {
            try {
                $bukkitYml = $this->fileRepository->setServer($server)->getContent('/bukkit.yml');

                return (bool) $bukkitYml;
            } catch (\Throwable $e) {
                return false;
            }
        });
    }

    /**
     * Get player manager status for server.
     */
    public function index(GetStatusRequest $request, Server $server): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        $properties = $this->getServerProperties($server);

        $onlineMode = !$this->isOfflineMode($server);
        $opped = [];
        $whitelisted = [];
        $whitelistEnabled = array_key_exists('white-list', $properties) && $properties['white-list'] === 'true';
        $banned = [];
        $bannedIps = [];

        // Load ops.json
        try {
            $ops = $this->fileRepository->setServer($server)->getContent('/ops.json');
            $data = json_decode($ops, true);

            foreach ($data as $op) {
                $uuid = str_replace('-', '', $op['uuid']);

                $opped[] = [
                    'uuid' => $op['uuid'],
                    'name' => $op['name'],
                    'level' => $op['level'],
                    'bypassesPlayerLimit' => $op['bypassesPlayerLimit'],
                    'avatar' => "https://minotar.net/helm/$uuid/256.png",
                    'render' => "https://render.skinmc.net/3d.php?user=$uuid&vr=-20&hr=30&hrh=0&vrll=-20&vrrl=10&vrla=10&vrra=-10&ratio=20",
                ];
            }
        } catch (\Throwable $e) {
            // ignore
        }

        // Load whitelist.json
        try {
            $whitelist = $this->fileRepository->setServer($server)->getContent('/whitelist.json');
            $data = json_decode($whitelist, true);

            foreach ($data as $whitelist) {
                $uuid = str_replace('-', '', $whitelist['uuid']);

                $whitelisted[] = [
                    'uuid' => $whitelist['uuid'],
                    'name' => $whitelist['name'],
                    'avatar' => "https://minotar.net/helm/$uuid/256.png",
                    'render' => "https://render.skinmc.net/3d.php?user=$uuid&vr=-20&hr=30&hrh=0&vrll=-20&vrrl=10&vrla=10&vrra=-10&ratio=20",
                ];
            }
        } catch (\Throwable $e) {
            // ignore
        }

        // Load banned-players.json
        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-players.json');
            $data = json_decode($bans, true);

            foreach ($data as $ban) {
                $uuid = str_replace('-', '', $ban['uuid']);

                $banned[] = [
                    'uuid' => $ban['uuid'],
                    'name' => $ban['name'],
                    'reason' => $ban['reason'],
                    'avatar' => "https://minotar.net/helm/$uuid/256.png",
                    'render' => "https://render.skinmc.net/3d.php?user=$uuid&vr=-20&hr=30&hrh=0&vrll=-20&vrrl=10&vrla=10&vrra=-10&ratio=20",
                ];
            }
        } catch (\Throwable $e) {
            // ignore
        }

        // Load banned-ips.json
        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-ips.json');
            $data = json_decode($bans, true);

            foreach ($data as $ban) {
                $bannedIps[] = [
                    'ip' => $ban['ip'],
                    'reason' => $ban['reason'],
                ];
            }
        } catch (\Throwable $e) {
            // ignore
        }

        // Try to query online players
        try {
            $data = $this->queryApi($server);

            $players = [];
            foreach ($data['players']['list'] ?? [] as $player) {
                $uuid = str_replace('-', '', $player['id']);

                if (preg_match('/^0+$/', $uuid) || str_starts_with($uuid, '0000000000000000')) {
                    continue;
                }

                $players[] = [
                    'uuid' => $player['id'],
                    'name' => $player['name'],
                    'avatar' => "https://minotar.net/helm/$uuid/256.png",
                    'render' => "https://render.skinmc.net/3d.php?user=$uuid&vr=-20&hr=30&hrh=0&vrll=-20&vrrl=10&vrla=10&vrra=-10&ratio=20",
                ];
            }

            return new JsonResponse([
                'server' => [
                    'online' => true,
                    'players' => [
                        'online' => $data['players']['online'],
                        'max' => $data['players']['max'],
                        'list' => $this->sortList($players),
                    ],
                    'version' => '',
                    'motd' => '',
                ],
                'operators' => $this->sortList($opped),
                'whitelist' => $this->sortList($whitelisted),
                'bannedPlayers' => $this->sortList($banned),
                'bannedIps' => $this->sortList($bannedIps),
                'whitelistEnabled' => $whitelistEnabled,
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'server' => [
                    'online' => false,
                    'players' => [
                        'online' => 0,
                        'max' => 0,
                        'list' => [],
                    ],
                    'version' => '',
                    'motd' => '',
                ],
                'operators' => $this->sortList($opped),
                'whitelist' => $this->sortList($whitelisted),
                'bannedPlayers' => $this->sortList($banned),
                'bannedIps' => $this->sortList($bannedIps),
                'whitelistEnabled' => $whitelistEnabled,
            ]);
        }
    }

    public function op(PlayerNamedRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $ops = $this->fileRepository->setServer($server)->getContent('/ops.json');
            $data = json_decode($ops, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        foreach ($data as $op) {
            if ($op['name'] === $name) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Player is already an operator',
                ], 400);
            }
        }

        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data[] = [
            'uuid' => $playerData['uuid'],
            'name' => $playerData['name'],
            'level' => 4,
            'bypassesPlayerLimit' => true,
        ];

        $this->fileRepository->setServer($server)->putContent('/ops.json', json_encode($data, JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:op {$playerData['name']}" : "op {$playerData['name']}";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.op')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name']])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function deop(PlayerRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $ops = $this->fileRepository->setServer($server)->getContent('/ops.json');
            $data = json_decode($ops, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        // Look up player by name from route parameter
        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data = array_filter($data, function ($op) use ($playerData) {
            return $op['uuid'] !== $playerData['uuid'];
        });

        $this->fileRepository->setServer($server)->putContent('/ops.json', json_encode(array_values($data), JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:deop {$playerData['name']}" : "deop {$playerData['name']}";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.deop')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name']])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function setWhitelist(SetWhitelistRequest $request, Server $server): array
    {
        $this->checkExtensionEnabled($server);

        try {
            $properties = $this->fileRepository->setServer($server)->getContent('/server.properties');
            $data = explode("\n", $properties);
        } catch (\Throwable $e) {
            $data = [];
        }

        $whitelist = $request->input('enabled');

        $data = array_map(function ($line) use ($whitelist) {
            if (str_starts_with($line, 'white-list=')) {
                return 'white-list=' . ($whitelist ? 'true' : 'false');
            }

            return $line;
        }, $data);

        if (!in_array('white-list=false', $data) && !in_array('white-list=true', $data)) {
            $data[] = 'white-list=' . ($whitelist ? 'true' : 'false');
        }

        Cache::forget("minecraftserver:properties:{$server->id}");
        $this->fileRepository->setServer($server)->putContent('/server.properties', implode("\n", $data));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? 'minecraft:whitelist ' : 'whitelist ';
            $this->commandRepository->setServer($server)->send($cmd . ($whitelist ? 'on' : 'off'));
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:whitelist.set')
            ->property(['enabled' => $whitelist])
            ->log();

        return ['success' => true];
    }

    public function addWhitelist(PlayerNamedRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $whitelist = $this->fileRepository->setServer($server)->getContent('/whitelist.json');
            $data = json_decode($whitelist, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        foreach ($data as $w) {
            if ($w['name'] === $name) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Player is already whitelisted',
                ], 400);
            }
        }

        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data[] = [
            'uuid' => $playerData['uuid'],
            'name' => $playerData['name'],
        ];

        $this->fileRepository->setServer($server)->putContent('/whitelist.json', json_encode($data, JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:whitelist add {$playerData['name']}" : "whitelist add {$playerData['name']}";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:whitelist.add')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name']])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function removeWhitelist(PlayerRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $whitelist = $this->fileRepository->setServer($server)->getContent('/whitelist.json');
            $data = json_decode($whitelist, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data = array_filter($data, function ($w) use ($playerData) {
            return $w['uuid'] !== $playerData['uuid'];
        });

        $this->fileRepository->setServer($server)->putContent('/whitelist.json', json_encode(array_values($data), JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:whitelist remove {$playerData['name']}" : "whitelist remove {$playerData['name']}";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:whitelist.remove')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name']])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function ban(BanRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        $reason = $this->sanitizeMessage($request->input('reason', 'Banned by panel'));

        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-players.json');
            $data = json_decode($bans, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        foreach ($data as $ban) {
            if ($ban['name'] === $name) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Player is already banned',
                ], 400);
            }
        }

        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data[] = [
            'uuid' => $playerData['uuid'],
            'name' => $playerData['name'],
            'source' => 'Panel',
            'created' => date('Y-m-d H:i:s O'),
            'expires' => 'forever',
            'reason' => $reason,
        ];

        $this->fileRepository->setServer($server)->putContent('/banned-players.json', json_encode($data, JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:ban {$playerData['name']} $reason" : "ban {$playerData['name']} $reason";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.ban')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name'], 'reason' => $reason])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function unban(PlayerRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-players.json');
            $data = json_decode($bans, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $data = array_filter($data, function ($ban) use ($playerData) {
            return $ban['uuid'] !== $playerData['uuid'];
        });

        $this->fileRepository->setServer($server)->putContent('/banned-players.json', json_encode(array_values($data), JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:pardon {$playerData['name']}" : "pardon {$playerData['name']}";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.unban')
            ->property(['uuid' => $playerData['uuid'], 'name' => $playerData['name']])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function banIp(BanIpRequest $request, Server $server, string $ip): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $ip = $this->sanitizeIpAddress($ip);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        $reason = $this->sanitizeMessage($request->input('reason', 'Banned by panel'));

        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-ips.json');
            $data = json_decode($bans, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        foreach ($data as $ban) {
            if ($ban['ip'] === $ip) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'IP is already banned',
                ], 400);
            }
        }

        $data[] = [
            'ip' => $ip,
            'source' => 'Panel',
            'created' => date('Y-m-d H:i:s O'),
            'expires' => 'forever',
            'reason' => $reason,
        ];

        $this->fileRepository->setServer($server)->putContent('/banned-ips.json', json_encode($data, JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:ban-ip $ip $reason" : "ban-ip $ip $reason";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.ban-ip')
            ->property(['ip' => $ip, 'reason' => $reason])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function unbanIp(IpRequest $request, Server $server, string $ip): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $ip = $this->sanitizeIpAddress($ip);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $bans = $this->fileRepository->setServer($server)->getContent('/banned-ips.json');
            $data = json_decode($bans, true);
        } catch (\Throwable $e) {
            $data = [];
        }

        $data = array_filter($data, function ($ban) use ($ip) {
            return $ban['ip'] !== $ip;
        });

        $this->fileRepository->setServer($server)->putContent('/banned-ips.json', json_encode(array_values($data), JSON_PRETTY_PRINT));
        usleep(500000);

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:pardon-ip $ip" : "pardon-ip $ip";
            $this->commandRepository->setServer($server)->send($cmd);
        } catch (\Throwable $e) {
            // ignore
        }

        Activity::event('server:player.unban-ip')
            ->property(['ip' => $ip])
            ->log();

        return new JsonResponse(['success' => true]);
    }

    public function kick(KickRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        $reason = $this->sanitizeMessage($request->input('reason', 'Kicked by panel'));

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:kick $name $reason" : "kick $name $reason";
            $this->commandRepository->setServer($server)->send($cmd);

            Activity::event('server:player.kick')
                ->property(['name' => $name, 'reason' => $reason])
                ->log();

            return new JsonResponse(['success' => true]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    public function whisper(WhisperRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        $message = $this->sanitizeMessage($request->input('message'));

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:tell $name $message" : "tell $name $message";
            $this->commandRepository->setServer($server)->send($cmd);

            Activity::event('server:player.whisper')
                ->property(['name' => $name, 'message' => $message])
                ->log();

            return new JsonResponse(['success' => true]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    public function kill(PlayerRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        try {
            $cmd = $this->isBukkitBased($server) ? "minecraft:kill $name" : "kill $name";
            $this->commandRepository->setServer($server)->send($cmd);

            Activity::event('server:player.kill')
                ->property(['name' => $name])
                ->log();

            return new JsonResponse(['success' => true]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    /**
     * Get the Minecraft server version (cached for 5 minutes).
     */
    public function getServerVersion(GetStatusRequest $request, Server $server): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        $version = Cache::remember("minecraftserver:version:{$server->id}", 300, function () use ($server) {
            try {
                $query = new MinecraftPing($server->allocation->alias ?? $server->allocation->ip, $server->allocation->port, 2, false);
                $query->Connect();
                $data = $query->Query();

                if (!$data || !isset($data['version']['name'])) {
                    return null;
                }

                $versionString = $data['version']['name'];

                // Parse version number from string (e.g., "1.20.4", "Paper 1.20.4", "Spigot 1.19.2")
                preg_match('/(\d+)\.(\d+)(?:\.(\d+))?/', $versionString, $matches);

                if (empty($matches)) {
                    return null;
                }

                $major = (int) $matches[1];
                $minor = (int) $matches[2];
                $patch = (int) ($matches[3] ?? 0);

                return [
                    'raw' => $versionString,
                    'major' => $major,
                    'minor' => $minor,
                    'patch' => $patch,
                    'protocol' => $data['version']['protocol'] ?? 0,
                    'supportsAttributes' => ($major >= 1 && $minor >= 16),
                ];
            } catch (\Throwable $e) {
                return null;
            }
        });

        if (!$version) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to detect server version',
            ], 400);
        }

        return new JsonResponse([
            'success' => true,
            'version' => $version,
        ]);
    }

    /**
     * Get player data from NBT file (inventory, location, stats).
     */
    public function getPlayerData(PlayerReadRequest $request, Server $server, string $player): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        // Look up player UUID
        $playerData = $this->lookupUserName($name, $server);

        if (is_null($playerData)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to lookup player',
            ], 400);
        }

        $uuid = $playerData['uuid'];

        // Find the world directory
        $worldDir = $this->getWorldDirectory($server);
        if (!$worldDir) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Could not find world directory',
            ], 400);
        }

        // Try to get the player data file
        $playerDataPath = "/{$worldDir}/playerdata/{$uuid}.dat";

        try {
            $datContent = $this->fileRepository->setServer($server)->getContent($playerDataPath);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Player data file has not been created yet. Please rejoin the server and try again.',
            ], 404);
        }

        try {
            // Write to temp file and parse
            $tempFile = tempnam(sys_get_temp_dir(), 'nbt_');
            file_put_contents($tempFile, $datContent);

            $parser = new NbtParser();
            $nbt = $parser->parseFile($tempFile);

            unlink($tempFile);

            // Extract data
            $inventory = NbtParser::extractInventory($nbt);
            $armor = NbtParser::extractArmor($nbt);
            $enderChest = NbtParser::extractEnderChest($nbt);
            $location = NbtParser::extractLocation($nbt);
            $stats = NbtParser::extractStats($nbt);

            // Debug: collect all slot numbers for troubleshooting
            $allSlots = array_map(fn ($item) => ['slot' => $item['slot'], 'id' => $item['id']], $inventory);

            // Debug: Get raw NBT keys to understand structure
            $nbtData = $nbt['value'] ?? $nbt;
            $nbtKeys = is_array($nbtData) ? array_keys($nbtData) : [];

            // Debug: Get equipment structure
            $equipmentDebug = $nbtData['equipment'] ?? null;

            // Sort inventory by slot
            usort($inventory, fn ($a, $b) => $a['slot'] <=> $b['slot']);

            // Filter out armor slots from main inventory (100-103) and offhand (-106, 45)
            $mainInventory = array_values(array_filter($inventory, fn ($item) => $item['slot'] >= 0 && $item['slot'] < 100));

            // Offhand: check equipment field first (1.20.5+), then inventory slot
            $offhand = null;
            if (isset($nbtData['equipment']['offhand']) && is_array($nbtData['equipment']['offhand']) && !empty($nbtData['equipment']['offhand'])) {
                $offhand = NbtParser::parseItemPublic($nbtData['equipment']['offhand']);
            } else {
                foreach ($inventory as $item) {
                    if ($item['slot'] === -106 || $item['slot'] === 45) {
                        $offhand = $item;
                        break;
                    }
                }
            }

            return new JsonResponse([
                'success' => true,
                'player' => [
                    'uuid' => $uuid,
                    'name' => $playerData['name'],
                ],
                'inventory' => $mainInventory,
                'armor' => $armor,
                'offhand' => $offhand,
                'enderChest' => $enderChest,
                'location' => $location,
                'stats' => $stats,
                'debug' => [
                    'allSlots' => $allSlots,
                    'nbtKeys' => $nbtKeys,
                    'equipment' => $equipmentDebug,
                ],
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Failed to parse player data: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get the world directory name.
     */
    private function getWorldDirectory(Server $server): ?string
    {
        return Cache::remember("minecraftserver:worlddir:{$server->id}", 60, function () use ($server) {
            $properties = $this->getServerProperties($server);
            $levelName = $properties['level-name'] ?? 'world';

            // Check if the directory exists
            try {
                $this->fileRepository->setServer($server)->getDirectory("/{$levelName}");

                return $levelName;
            } catch (\Throwable $e) {
                // Try common alternatives
                $alternatives = ['world', 'server', 'minecraft'];
                foreach ($alternatives as $alt) {
                    try {
                        $this->fileRepository->setServer($server)->getDirectory("/{$alt}");

                        return $alt;
                    } catch (\Throwable $e) {
                        continue;
                    }
                }
            }

            return null;
        });
    }

    /**
     * Get a specific attribute for a player.
     */
    public function getAttribute(PlayerReadRequest $request, Server $server, string $player, string $attribute): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        // Validate attribute name
        $attribute = $this->sanitizeAttributeName($attribute);
        if (!$attribute) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Invalid attribute name',
            ], 400);
        }

        try {
            // First check if attributes are supported
            $version = Cache::get("minecraftserver:version:{$server->id}");
            if ($version && !$version['supportsAttributes']) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Attributes require Minecraft 1.16 or higher',
                ], 400);
            }

            // Use data get to retrieve attribute value via data command
            $cmd = "data get entity {$name} Attributes";
            $this->commandRepository->setServer($server)->send($cmd);

            // Since we can't read command output directly, we'll return the available attributes
            return new JsonResponse([
                'success' => true,
                'message' => 'Attribute command sent. Check server console for result.',
                'attribute' => $attribute,
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    /**
     * Set an attribute value for a player.
     */
    public function setAttribute(AttributeRequest $request, Server $server, string $player, string $attribute): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        // Validate attribute name
        $attribute = $this->sanitizeAttributeName($attribute);
        if (!$attribute) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Invalid attribute name',
            ], 400);
        }

        $value = $request->input('value');
        if (!is_numeric($value)) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Value must be a number',
            ], 400);
        }

        // Clamp value to reasonable range
        $value = max(-1024, min(1024, (float) $value));

        try {
            // Check if attributes are supported
            $version = Cache::get("minecraftserver:version:{$server->id}");
            if ($version && !$version['supportsAttributes']) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Attributes require Minecraft 1.16 or higher',
                ], 400);
            }

            $cmd = "attribute {$name} minecraft:{$attribute} base set {$value}";
            $this->commandRepository->setServer($server)->send($cmd);

            Activity::event('server:player.attribute.set')
                ->property(['name' => $name, 'attribute' => $attribute, 'value' => $value])
                ->log();

            return new JsonResponse([
                'success' => true,
                'attribute' => $attribute,
                'value' => $value,
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    /**
     * Reset an attribute to its default value.
     */
    public function resetAttribute(PlayerRequest $request, Server $server, string $player, string $attribute): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        try {
            $name = $this->sanitizePlayerName($player);
        } catch (\InvalidArgumentException $e) {
            return new JsonResponse([
                'success' => false,
                'error' => $e->getMessage(),
            ], 400);
        }

        // Validate attribute name
        $attribute = $this->sanitizeAttributeName($attribute);
        if (!$attribute) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Invalid attribute name',
            ], 400);
        }

        try {
            // Check if attributes are supported
            $version = Cache::get("minecraftserver:version:{$server->id}");
            if ($version && !$version['supportsAttributes']) {
                return new JsonResponse([
                    'success' => false,
                    'error' => 'Attributes require Minecraft 1.16 or higher',
                ], 400);
            }

            // Use the attribute reset command (1.20+) or set to default
            $defaultValue = $this->getAttributeDefault($attribute);
            $cmd = "attribute {$name} minecraft:{$attribute} base set {$defaultValue}";
            $this->commandRepository->setServer($server)->send($cmd);

            Activity::event('server:player.attribute.reset')
                ->property(['name' => $name, 'attribute' => $attribute])
                ->log();

            return new JsonResponse([
                'success' => true,
                'attribute' => $attribute,
                'defaultValue' => $defaultValue,
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Server is offline',
            ], 400);
        }
    }

    /**
     * Get all available attributes with their metadata.
     */
    public function getAttributes(GetStatusRequest $request, Server $server): JsonResponse
    {
        $this->checkExtensionEnabled($server);

        // Check if attributes are supported
        $version = Cache::get("minecraftserver:version:{$server->id}");
        if ($version && !$version['supportsAttributes']) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Attributes require Minecraft 1.16 or higher',
            ], 400);
        }

        return new JsonResponse([
            'success' => true,
            'attributes' => $this->getAttributeList($version),
        ]);
    }

    /**
     * Sanitize and validate attribute name.
     */
    private function sanitizeAttributeName(string $attribute): ?string
    {
        // Remove minecraft: prefix if present
        $attribute = str_replace('minecraft:', '', $attribute);

        // Only allow alphanumeric and underscores
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $attribute)) {
            return null;
        }

        // Validate against known player attributes (without generic. or player. prefixes)
        // Note: flying_speed, follow_range, tempt_range, spawn_reinforcements are mob-only
        $validAttributes = [
            // Base attributes (1.16+)
            'max_health', 'knockback_resistance',
            'movement_speed', 'attack_damage',
            'attack_knockback', 'attack_speed', 'armor',
            'armor_toughness', 'luck',
            // Player specific (1.20.5+)
            'block_interaction_range', 'entity_interaction_range',
            'block_break_speed', 'mining_efficiency', 'sneaking_speed',
            'submerged_mining_speed', 'sweeping_damage_ratio',
            // 1.21+ attributes
            'scale', 'step_height', 'gravity',
            'safe_fall_distance', 'fall_damage_multiplier',
            'jump_strength', 'oxygen_bonus',
            'burning_time', 'explosion_knockback_resistance',
            'water_movement_efficiency',
        ];

        if (!in_array($attribute, $validAttributes)) {
            return null;
        }

        return $attribute;
    }

    /**
     * Get default value for an attribute.
     */
    private function getAttributeDefault(string $attribute): float
    {
        $defaults = [
            'max_health' => 20.0,
            'knockback_resistance' => 0.0,
            'movement_speed' => 0.1,
            'attack_damage' => 1.0,
            'attack_knockback' => 0.0,
            'attack_speed' => 4.0,
            'armor' => 0.0,
            'armor_toughness' => 0.0,
            'luck' => 0.0,
            'scale' => 1.0,
            'step_height' => 0.6,
            'gravity' => 0.08,
            'safe_fall_distance' => 3.0,
            'fall_damage_multiplier' => 1.0,
            'jump_strength' => 0.42,
            'oxygen_bonus' => 0.0,
            'burning_time' => 1.0,
            'explosion_knockback_resistance' => 0.0,
            'water_movement_efficiency' => 0.0,
            'block_interaction_range' => 4.5,
            'entity_interaction_range' => 3.0,
            'block_break_speed' => 1.0,
            'mining_efficiency' => 0.0,
            'sneaking_speed' => 0.3,
            'submerged_mining_speed' => 0.2,
            'sweeping_damage_ratio' => 0.0,
        ];

        return $defaults[$attribute] ?? 0.0;
    }

    /**
     * Get list of all attributes with metadata.
     */
    private function getAttributeList(?array $version): array
    {
        $minor = $version['minor'] ?? 20;

        $attributes = [
            [
                'category' => 'Health & Defense',
                'attributes' => [
                    ['id' => 'max_health', 'name' => 'Max Health', 'default' => 20.0, 'min' => 1, 'max' => 1024, 'description' => 'Maximum health points'],
                    ['id' => 'armor', 'name' => 'Armor', 'default' => 0.0, 'min' => 0, 'max' => 30, 'description' => 'Armor points'],
                    ['id' => 'armor_toughness', 'name' => 'Armor Toughness', 'default' => 0.0, 'min' => 0, 'max' => 20, 'description' => 'Reduces armor penetration'],
                    ['id' => 'knockback_resistance', 'name' => 'Knockback Resistance', 'default' => 0.0, 'min' => 0, 'max' => 1, 'description' => 'Chance to resist knockback (0-1)'],
                ],
            ],
            [
                'category' => 'Combat',
                'attributes' => [
                    ['id' => 'attack_damage', 'name' => 'Attack Damage', 'default' => 1.0, 'min' => 0, 'max' => 2048, 'description' => 'Base melee damage'],
                    ['id' => 'attack_speed', 'name' => 'Attack Speed', 'default' => 4.0, 'min' => 0, 'max' => 1024, 'description' => 'Attack cooldown recovery speed'],
                    ['id' => 'attack_knockback', 'name' => 'Attack Knockback', 'default' => 0.0, 'min' => 0, 'max' => 5, 'description' => 'Knockback dealt on attack'],
                ],
            ],
            [
                'category' => 'Movement',
                'attributes' => [
                    ['id' => 'movement_speed', 'name' => 'Movement Speed', 'default' => 0.1, 'min' => 0, 'max' => 1024, 'description' => 'Walking/running speed'],
                ],
            ],
            [
                'category' => 'Miscellaneous',
                'attributes' => [
                    ['id' => 'luck', 'name' => 'Luck', 'default' => 0.0, 'min' => -1024, 'max' => 1024, 'description' => 'Affects loot table quality'],
                ],
            ],
        ];

        // Add 1.20.5+ attributes
        if ($minor >= 20) {
            $attributes[] = [
                'category' => 'Player Reach (1.20.5+)',
                'attributes' => [
                    ['id' => 'block_interaction_range', 'name' => 'Block Interaction Range', 'default' => 4.5, 'min' => 0, 'max' => 64, 'description' => 'How far you can interact with blocks'],
                    ['id' => 'entity_interaction_range', 'name' => 'Entity Interaction Range', 'default' => 3.0, 'min' => 0, 'max' => 64, 'description' => 'How far you can interact with entities'],
                    ['id' => 'block_break_speed', 'name' => 'Block Break Speed', 'default' => 1.0, 'min' => 0, 'max' => 1024, 'description' => 'Mining speed multiplier'],
                    ['id' => 'mining_efficiency', 'name' => 'Mining Efficiency', 'default' => 0.0, 'min' => 0, 'max' => 1024, 'description' => 'Additional mining speed'],
                    ['id' => 'sneaking_speed', 'name' => 'Sneaking Speed', 'default' => 0.3, 'min' => 0, 'max' => 1, 'description' => 'Speed while sneaking (0-1)'],
                    ['id' => 'submerged_mining_speed', 'name' => 'Underwater Mining Speed', 'default' => 0.2, 'min' => 0, 'max' => 20, 'description' => 'Mining speed multiplier underwater'],
                ],
            ];
        }

        // Add 1.21+ attributes
        if ($minor >= 21) {
            $attributes[] = [
                'category' => 'Physics (1.21+)',
                'attributes' => [
                    ['id' => 'scale', 'name' => 'Scale', 'default' => 1.0, 'min' => 0.0625, 'max' => 16, 'description' => 'Entity size multiplier'],
                    ['id' => 'step_height', 'name' => 'Step Height', 'default' => 0.6, 'min' => 0, 'max' => 10, 'description' => 'Max height that can be stepped up'],
                    ['id' => 'gravity', 'name' => 'Gravity', 'default' => 0.08, 'min' => -1, 'max' => 1, 'description' => 'Gravity strength'],
                    ['id' => 'safe_fall_distance', 'name' => 'Safe Fall Distance', 'default' => 3.0, 'min' => -1024, 'max' => 1024, 'description' => 'Distance before fall damage'],
                    ['id' => 'fall_damage_multiplier', 'name' => 'Fall Damage Multiplier', 'default' => 1.0, 'min' => 0, 'max' => 100, 'description' => 'Fall damage multiplier'],
                    ['id' => 'jump_strength', 'name' => 'Jump Strength', 'default' => 0.42, 'min' => 0, 'max' => 32, 'description' => 'Jump power'],
                    ['id' => 'oxygen_bonus', 'name' => 'Oxygen Bonus', 'default' => 0.0, 'min' => 0, 'max' => 1024, 'description' => 'Extra breath time underwater'],
                    ['id' => 'burning_time', 'name' => 'Burning Time', 'default' => 1.0, 'min' => 0, 'max' => 1024, 'description' => 'Fire damage duration multiplier'],
                    ['id' => 'explosion_knockback_resistance', 'name' => 'Explosion Knockback Resistance', 'default' => 0.0, 'min' => 0, 'max' => 1, 'description' => 'Resistance to explosion knockback (0-1)'],
                    ['id' => 'water_movement_efficiency', 'name' => 'Water Movement Efficiency', 'default' => 0.0, 'min' => 0, 'max' => 1, 'description' => 'Movement speed in water (0-1)'],
                ],
            ];
        }

        return $attributes;
    }
}
