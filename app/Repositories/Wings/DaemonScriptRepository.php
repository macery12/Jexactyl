<?php

namespace Everest\Repositories\Wings;

use Everest\Models\Server;
use Webmozart\Assert\Assert;
use GuzzleHttp\Exception\TransferException;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

class DaemonScriptRepository extends DaemonRepository
{
    /**
     * Runs a shell script inside a throwaway container with the server's data
     * directory bind-mounted at /mnt/server, and returns the captured output.
     *
     * The call blocks until the script exits, so a generous timeout must be
     * supplied — the default Guzzle timeout (15s) is far too short for an
     * install that downloads dozens of mods.
     *
     * @param array<string, scalar> $environment    env vars injected into the container
     * @param string|null           $containerImage overrides the default installer image — e.g. a
     *                                              Java image when the script must run `java` (loader installs)
     *
     * @return array{stdout: string, stderr: string}
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function run(string $script, array $environment = [], ?int $timeout = null, ?string $containerImage = null): array
    {
        Assert::isInstanceOf($this->server, Server::class);

        $options = [
            'json' => [
                'container_image' => $containerImage ?: config('modules.mods.installer.container_image'),
                'entrypoint'      => 'bash',
                'script'          => $script,
                'environment'     => (object) $environment,
            ],
        ];

        if ($timeout !== null) {
            $options['timeout'] = $timeout;
        }

        try {
            $response = $this->getHttpClient()->post(
                sprintf('/api/servers/%s/script', $this->server->uuid),
                $options
            );
        } catch (TransferException $exception) {
            throw new DaemonConnectionException($exception);
        }

        $body = json_decode($response->getBody()->__toString(), true);

        return [
            'stdout' => (string) ($body['stdout'] ?? ''),
            'stderr' => (string) ($body['stderr'] ?? ''),
        ];
    }
}
