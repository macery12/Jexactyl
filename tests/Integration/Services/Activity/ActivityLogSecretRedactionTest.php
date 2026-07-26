<?php

namespace Everest\Tests\Integration\Services\Activity;

use Everest\Facades\Activity;
use Everest\Models\ActivityLog;
use Everest\Services\Security\LogSanitizer;
use Everest\Tests\Integration\IntegrationTestCase;

class ActivityLogSecretRedactionTest extends IntegrationTestCase
{
    public function testSentinelSecretsAreRedactedBeforePersistence(): void
    {
        config()->set('activity.enabled.account', true);
        config()->set('modules.webhooks.enabled', false);
        $sentinel = 'M12-PERSISTED-SECRET-SENTINEL';

        Activity::event('security:redaction-test')
            ->property([
                'database' => [
                    'password' => $sentinel,
                ],
                'merchant_setting' => [
                    'key' => 'paypal_standalone:client_secret',
                    'value' => $sentinel,
                ],
                'safe' => 'retained',
            ])
            ->log();

        $stored = ActivityLog::query()
            ->where('event', 'security:redaction-test')
            ->firstOrFail();
        $properties = $stored->properties->toArray();

        $this->assertSame(LogSanitizer::REDACTED_VALUE, $properties['database']['password']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $properties['merchant_setting']['value']);
        $this->assertSame('retained', $properties['safe']);
        $this->assertStringNotContainsString(
            $sentinel,
            json_encode($properties, JSON_THROW_ON_ERROR)
        );
    }
}
