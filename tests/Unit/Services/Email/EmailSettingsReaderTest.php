<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Services\Email\ResendPlanResolver;
use Everest\Services\Email\ResendQuotaService;
use Everest\Services\Email\EmailSettingsReader;

class EmailSettingsReaderTest extends TestCase
{
    public function testItNormalizesDeliveryEnabledAndTransportValues(): void
    {
        $reader = \Mockery::mock(EmailSettingsReader::class)->makePartial();
        $reader->shouldReceive('get')->with('settings::modules:email:resend:enabled', false)->andReturn(false);
        $reader->shouldReceive('get')->with('settings::modules:email:enabled', false)->andReturn('true');
        $reader->shouldReceive('get')->with('settings::modules:email:transport', null)->andReturn('resend');

        $this->assertTrue($reader->deliveryEnabled());
        $this->assertSame('resend', $reader->transport());
    }

    public function testItBuildsAdminSettingsPayload(): void
    {
        $plan = [
            'key' => 'free',
            'name' => 'Free',
            'daily_limit' => 100,
            'monthly_limit' => 3000,
            'enforce_daily' => true,
            'enforce_monthly' => true,
            'allows_custom_limits' => false,
            'custom_daily_limit' => null,
            'custom_monthly_limit' => null,
        ];

        $planResolver = \Mockery::mock(ResendPlanResolver::class);
        $planResolver->shouldReceive('all')->andReturn([$plan]);
        $planResolver->shouldReceive('activePlan')->andReturn($plan);
        app()->instance(ResendPlanResolver::class, $planResolver);

        $quotaService = \Mockery::mock(ResendQuotaService::class);
        $quotaService->shouldReceive('usage')->andReturn([
            'plan' => $plan,
            'usage' => [
                'daily_sent' => 0,
                'monthly_sent' => 0,
                'daily_limit' => $plan['daily_limit'],
                'monthly_limit' => $plan['monthly_limit'],
                'daily_remaining' => $plan['daily_limit'],
                'monthly_remaining' => $plan['monthly_limit'],
                'next_daily_reset' => null,
                'next_monthly_reset' => null,
                'source' => 'provider',
                'synced_at' => null,
            ],
            'rate_limit' => [
                'limit' => '5',
                'remaining' => '3',
                'reset' => '15',
                'retry_after' => '2',
                'updated_at' => null,
            ],
        ]);
        app()->instance(ResendQuotaService::class, $quotaService);

        $reader = \Mockery::mock(EmailSettingsReader::class)->makePartial();
        $reader->shouldReceive('transport')->andReturn('smtp');
        $reader->shouldReceive('deliveryEnabled')->andReturn(true);
        $reader->shouldReceive('get')->with('settings::modules:email:resend:api_key', '')->andReturn('secret');
        $reader->shouldReceive('get')->with('settings::modules:email:resend:from_email', '')->andReturn('noreply@example.com');
        $reader->shouldReceive('get')->with('settings::modules:email:resend:from_name', '')->andReturn('App');
        $reader->shouldReceive('get')->with('settings::modules:email:resend:reply_to', '')->andReturn('help@example.com');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:host', '')->andReturn('smtp.example.com');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:port', '')->andReturn('587');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:username', '')->andReturn('mailer');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:password', '')->andReturn('secret');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:encryption', '')->andReturn('tls');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:from_email', '')->andReturn('smtp@example.com');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:from_name', '')->andReturn('SMTP');
        $reader->shouldReceive('get')->with('settings::modules:email:smtp:reply_to', '')->andReturn('reply@example.com');

        $settings = $reader->adminSettings();

        $this->assertTrue($settings['enabled']);
        $this->assertSame('smtp', $settings['transport']);
        $this->assertTrue($settings['enabled']);
        $this->assertTrue($settings['resend']['api_key']);
        $this->assertTrue($settings['smtp']['password_set']);
        $this->assertSame('noreply@example.com', $settings['resend']['from_email']);
        $this->assertSame($plan['key'], $settings['resend_plan']['key']);
        $this->assertSame($plan['daily_limit'], $settings['resend_usage']['daily_limit']);
        $this->assertSame('provider', $settings['resend_usage']['source']);
        $this->assertSame('5', $settings['resend_rate_limit']['limit']);
    }
}
