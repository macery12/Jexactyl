<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Models\ResendQuota;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Email\ResendPlanResolver;
use Everest\Services\Email\ResendQuotaService;

class ResendQuotaServiceTest extends TestCase
{
    private array $plan = [
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

    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('resend_quotas');
        Schema::create('resend_quotas', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('daily_sent')->default(0);
            $table->unsignedInteger('monthly_sent')->default(0);
            $table->date('day_reset_at')->nullable();
            $table->date('month_reset_at')->nullable();
            $table->timestamps();
        });

        $resolver = \Mockery::mock(ResendPlanResolver::class);
        $resolver->shouldReceive('activePlan')->andReturn($this->plan);
        $resolver->shouldReceive('all')->andReturn([$this->plan]);
        app()->instance(ResendPlanResolver::class, $resolver);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('resend_quotas');
        parent::tearDown();
    }

    public function testReserveAllowsWhenUnderLimit(): void
    {
        $service = app(ResendQuotaService::class);

        $reservation = $service->reserve();

        $this->assertTrue($reservation->allowed);

        $this->assertSame(1, ResendQuota::singleton()->fresh()->monthly_sent);
        $this->assertSame(1, ResendQuota::singleton()->fresh()->daily_sent);
    }

    public function testReserveBlocksWhenMonthlyLimitExceeded(): void
    {
        $resolver = \Mockery::mock(ResendPlanResolver::class);
        $resolver->shouldReceive('activePlan')->andReturn([
            'key' => 'free',
            'name' => 'Free',
            'daily_limit' => 100000,
            'monthly_limit' => 3000,
            'enforce_daily' => true,
            'enforce_monthly' => true,
            'allows_custom_limits' => false,
            'custom_daily_limit' => null,
            'custom_monthly_limit' => null,
        ]);
        app()->instance(ResendPlanResolver::class, $resolver);

        $quota = ResendQuota::singleton();
        $quota->monthly_sent = 3000;
        $quota->daily_sent = 50;
        $quota->day_reset_at = now()->startOfDay();
        $quota->month_reset_at = now()->startOfMonth();
        $quota->save();

        $reservation = ResendQuota::singleton()->reserve([
            'daily_limit' => 100000,
            'monthly_limit' => 3000,
            'enforce_daily' => true,
            'enforce_monthly' => true,
        ], 3001);

        $this->assertFalse($reservation['allowed']);
        $this->assertSame('resend_monthly_quota_reached', $reservation['reason']);
        $this->assertNotNull($reservation['scheduled_at']);
    }
}
