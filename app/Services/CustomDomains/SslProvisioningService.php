<?php

namespace Everest\Services\CustomDomains;

use Illuminate\Support\Facades\Process;

class SslProvisioningService
{
    public function requestCertificate(string $fullDomain): void
    {
        if (!(bool) config('modules.custom_domains.ssl.enabled', false)) {
            throw new \Exception('SSL provisioning is disabled by configuration.');
        }

        $commandTemplate = trim((string) config('modules.custom_domains.ssl.command', ''));
        if ($commandTemplate === '') {
            throw new \Exception('SSL provisioning command is not configured.');
        }

        $command = str_replace('{domain}', $fullDomain, $commandTemplate);
        $timeout = (int) config('modules.custom_domains.ssl.timeout', 120);

        $result = Process::timeout($timeout)->run($command);

        if (!$result->successful()) {
            throw new \Exception('SSL provisioning command failed: ' . $result->errorOutput());
        }
    }
}
