<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Everest\Exceptions\DisplayException;
use Everest\Services\Billing\BillingCycleService;
use Everest\Services\Billing\NodeAvailabilityService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Repositories\Wings\DaemonConfigurationRepository;

class BillingValidationServiceTest extends TestCase
{
    private BillingValidationService $service;

    public function setUp(): void
    {
        parent::setUp();

        $nodeAvailabilityService = new NodeAvailabilityService(
            \Mockery::mock(DaemonConfigurationRepository::class)
        );

        $this->service = new BillingValidationService(
            $nodeAvailabilityService,
            \Mockery::mock(BillingCycleService::class),
        );
    }

    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testValidatePriceTypeTreatsTinyOrNegativeTotalsAsFree(): void
    {
        $this->service->validatePriceType(0.0001, true);
        $this->service->validatePriceType(-0.25, true);

        $this->assertTrue(true, 'Free totals at or below epsilon (including negatives) should not throw.');
    }

    public function testValidatePriceTypeRejectsPaidFlowForFreeTotals(): void
    {
        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('This order total is $0. Please use the free order process instead of payment.');

        $this->service->validatePriceType(0.0, false);
    }

    public function testValidatePriceTypeRequiresPaymentWhenAboveThreshold(): void
    {
        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('This product is not free. Please use the payment process.');

        $this->service->validatePriceType(0.01, true);
    }
}
