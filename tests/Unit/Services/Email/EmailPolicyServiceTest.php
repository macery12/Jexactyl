<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Services\Email\EmailPolicyService;
use Everest\Services\Email\EmailSettingsReader;

class EmailPolicyServiceTest extends TestCase
{
    public function testItUsesReaderForDeliveryEnabledAndRecipientBlocking(): void
    {
        config(['email.domain_blacklist' => []]);

        $settings = \Mockery::mock(EmailSettingsReader::class);
        $settings->shouldReceive('deliveryEnabled')->once()->andReturn(true);
        $policy = new EmailPolicyService($settings);

        $this->assertTrue($policy->isDeliveryEnabled());
        $this->assertFalse($policy->isBlockedRecipient('person@example.com'));
        $this->assertTrue($policy->isBlockedRecipient('not-an-email'));
    }

    public function testItValidatesTemplateDataThroughRegistry(): void
    {
        $policy = app(EmailPolicyService::class);

        [$valid, $errors] = $policy->validateTemplateData('auth.password_reset', [
            'userName' => 'Demo User',
            'resetUrl' => 'https://example.com/reset',
            'unexpected' => 'value',
        ]);

        $this->assertSame([
            'userName' => 'Demo User',
            'resetUrl' => 'https://example.com/reset',
        ], $valid);
        $this->assertCount(1, $errors);
        $this->assertStringContainsString('unexpected', $errors[0]);
    }
}
