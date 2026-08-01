<?php

namespace Everest\Tests\Unit\Services\Migration;

use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Everest\Services\Migration\TablePlan;
use Everest\Services\Migration\Profiles\PterodactylProfile;

class PterodactylProfileApiKeyTest extends TestCase
{
    public function testImportedApplicationKeysAlwaysRetainEnforcedScopes(): void
    {
        $plan = $this->apiKeyPlan();
        $default = $plan->defaults['acl_enforced'];

        $this->assertTrue($default(['key_type' => ApiKey::TYPE_APPLICATION]));
        $this->assertFalse($default(['key_type' => ApiKey::TYPE_ACCOUNT]));
    }

    public function testHistoricalReadWriteValueIsNormalizedDuringImport(): void
    {
        $transform = $this->apiKeyPlan()->transforms['r_nodes'];

        $this->assertSame(3, $transform(2));
        $this->assertSame(1, $transform(1));
        $this->assertSame(0, $transform(0));
    }

    private function apiKeyPlan(): TablePlan
    {
        foreach ((new PterodactylProfile())->tables() as $plan) {
            if ($plan->table === 'api_keys') {
                return $plan;
            }
        }

        $this->fail('The Pterodactyl profile has no api_keys plan.');
    }
}
