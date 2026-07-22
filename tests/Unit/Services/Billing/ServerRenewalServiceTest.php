<?php

namespace Everest\Tests\Unit\Services\Billing;

use Carbon\Carbon;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;
use Everest\Services\Servers\SuspensionService;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\ServerRenewalService;

class ServerRenewalServiceTest extends TestCase
{
    private ServerRenewalService $service;
    private $suspensionService;
    private $orderService;

    /**
     * Setup test instance.
     */
    public function setUp(): void
    {
        parent::setUp();

        $this->suspensionService = \Mockery::mock(SuspensionService::class);
        $this->orderService = \Mockery::mock(CreateOrderService::class);

        $this->service = new ServerRenewalService(
            $this->suspensionService,
            $this->orderService
        );
    }

    /**
     * Test that renewal subtracts past due days when server is overdue but within grace period.
     */
    public function testRenewalSubtractsPastDueDaysWhenWithinGracePeriod()
    {
        // Mock server that is 5 days past due
        $server = $this->createMockServer(5, false);

        // Mock product with 30-day billing cycle
        $product = $this->createMockProduct(false, 30);

        // Mock order creation
        $order = $this->createMockOrder();
        $this->orderService->shouldReceive('create')->once()->andReturn($order);

        // Server is not suspended, so no unsuspend needed
        $server->shouldReceive('isSuspended')->andReturn(false);

        // Get the suspension threshold for 30-day cycle (should be 6 days)
        // Based on formula: min(max(30 * 0.20, 3), 7) = 6 days
        $product->shouldReceive('getSuspensionThresholdForBillingCycle')
            ->with(30)
            ->andReturn(6);

        // Server should be updated with adjusted renewal date
        // Since server is 5 days past due and renewing for 30 days,
        // it should only get 25 days (30 - 5)
        $expectedDays = 25;
        $server->shouldReceive('update')
            ->once()
            ->with(\Mockery::on(function ($arg) {
                if (!isset($arg['renewal_date'], $arg['billing_days'], $arg['billing_amount'])) {
                    return false;
                }

                return (int) $arg['billing_days'] === 30
                    && (float) $arg['billing_amount'] === 10.0;
            }))
            ->andReturnNull();

        // Order should be marked as processed
        $order->shouldReceive('update')->once()->andReturnNull();
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        // Execute the renewal
        $result = $this->service->renew($server, $product, null, 30);

        $this->assertArrayHasKey('server', $result);
        $this->assertArrayHasKey('order', $result);
    }

    /**
     * Test that renewal gives full days when server is not past due.
     */
    public function testRenewalGivesFullDaysWhenNotPastDue()
    {
        // Mock server that is NOT past due (5 days remaining)
        $server = $this->createMockServer(-5, false);

        // Mock product with 30-day billing cycle
        $product = $this->createMockProduct(false, 30);

        // Mock order creation
        $order = $this->createMockOrder();
        $this->orderService->shouldReceive('create')->once()->andReturn($order);

        // Server is not suspended
        $server->shouldReceive('isSuspended')->andReturn(false);

        // Server should be updated with full 30 days added to future renewal date
        $server->shouldReceive('update')
            ->once()
            ->with(\Mockery::on(function ($arg) {
                if (!isset($arg['renewal_date'], $arg['billing_days'], $arg['billing_amount'])) {
                    return false;
                }

                return (int) $arg['billing_days'] === 30
                    && (float) $arg['billing_amount'] === 10.0;
            }))
            ->andReturnNull();

        // Order should be marked as processed
        $order->shouldReceive('update')->once()->andReturnNull();
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        // Execute the renewal
        $result = $this->service->renew($server, $product, null, 30);

        $this->assertArrayHasKey('server', $result);
        $this->assertArrayHasKey('order', $result);
    }

    /**
     * Test that renewal still processes when server is past grace period.
     * (This shouldn't normally happen as UI should block it, but if it does, don't adjust days).
     */
    public function testRenewalDoesNotAdjustDaysWhenPastGracePeriod()
    {
        // Mock server that is 10 days past due (past the 6-day grace period for 30-day cycle)
        $server = $this->createMockServer(10, true);

        // Mock product with 30-day billing cycle
        $product = $this->createMockProduct(false, 30);

        // Mock order creation
        $order = $this->createMockOrder();
        $this->orderService->shouldReceive('create')->once()->andReturn($order);

        // Server is suspended, should be unsuspended
        $server->shouldReceive('isSuspended')->andReturn(true);
        $this->suspensionService->shouldReceive('toggle')
            ->once()
            ->with($server, SuspensionService::ACTION_UNSUSPEND)
            ->andReturnNull();

        // Get the suspension threshold for 30-day cycle (should be 6 days)
        $product->shouldReceive('getSuspensionThresholdForBillingCycle')
            ->with(30)
            ->andReturn(6);

        // When past grace period, give full 30 days from now
        // (though in practice this shouldn't happen as payment should be blocked)
        $server->shouldReceive('update')
            ->once()
            ->with(\Mockery::on(function ($arg) {
                if (!isset($arg['renewal_date'], $arg['billing_days'], $arg['billing_amount'])) {
                    return false;
                }

                return (int) $arg['billing_days'] === 30
                    && (float) $arg['billing_amount'] === 10.0;
            }))
            ->andReturnNull();

        // Order should be marked as processed
        $order->shouldReceive('update')->once()->andReturnNull();
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        // Execute the renewal
        $result = $this->service->renew($server, $product, null, 30);

        $this->assertArrayHasKey('server', $result);
        $this->assertArrayHasKey('order', $result);
    }

    /**
     * Test that renewal ensures at least 1 day is given even if past due exceeds renewal days.
     */
    public function testRenewalEnsuresAtLeastOneDayIsGiven()
    {
        // Mock server that is 3 days past due
        $server = $this->createMockServer(3, false);

        // Mock product with 7-day billing cycle (short cycle for free server)
        $product = $this->createMockProduct(true, 7);

        // Mock order creation
        $order = $this->createMockOrder();
        $this->orderService->shouldReceive('create')->once()->andReturn($order);

        // Server is not suspended
        $server->shouldReceive('isSuspended')->andReturn(false);

        // For free products, the threshold is typically 7 days
        $product->shouldReceive('getSuspensionThresholdForBillingCycle')
            ->with(7)
            ->andReturn(7);

        // Free server renewal uses 7 days, minus 3 past due = 4 days
        $expectedDays = 4;
        $server->shouldReceive('update')
            ->once()
            ->with(\Mockery::on(function ($arg) {
                if (!isset($arg['renewal_date'], $arg['billing_days'], $arg['billing_amount'])) {
                    return false;
                }

                return (int) $arg['billing_days'] === 7
                    && (float) $arg['billing_amount'] === 10.0;
            }))
            ->andReturnNull();

        // Order should be marked as processed
        $order->shouldReceive('update')->once()->andReturnNull();
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        // Execute the renewal
        $result = $this->service->renew($server, $product, null, 7);

        $this->assertArrayHasKey('server', $result);
        $this->assertArrayHasKey('order', $result);
    }

    /**
     * Test that selected billing cycle is persisted for future renewals.
     */
    public function testRenewalPersistsSelectedBillingDays()
    {
        $server = $this->createMockServer(-2, false);
        $product = $this->createMockProduct(false, 30);

        $order = $this->createMockOrder();
        $this->orderService->shouldReceive('create')->once()->andReturn($order);

        $server->shouldReceive('isSuspended')->andReturn(false);

        $selectedBillingDays = 60;
        $server->shouldReceive('update')
            ->once()
            ->with(
                \Mockery::on(function ($arg) use ($selectedBillingDays) {
                    return isset($arg['billing_days'])
                        && (int) $arg['billing_days'] === $selectedBillingDays
                        && isset($arg['renewal_date'], $arg['billing_amount'])
                        && (float) $arg['billing_amount'] === 10.0;
                })
            )
            ->andReturnNull();

        $order->shouldReceive('update')->once()->andReturnNull();
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        $result = $this->service->renew($server, $product, null, $selectedBillingDays);

        $this->assertArrayHasKey('server', $result);
        $this->assertArrayHasKey('order', $result);
    }

    /**
     * Test that renewal throws exception when server doesn't match product.
     */
    public function testRenewalThrowsExceptionWhenProductMismatch()
    {
        $server = $this->createMockServer(0, false, 999);
        $product = $this->createMockProduct(false, 30);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('This server does not use this product');

        $this->service->renew($server, $product, null, 30);
    }

    /**
     * Create a mock server.
     *
     * @param int $daysOverdue Positive number for past due, negative for future
     * @param bool $isSuspended Whether the server is suspended
     */
    private function createMockServer(int $daysOverdue, bool $isSuspended, int $billingProductId = 123): Server
    {
        $user = \Mockery::mock(User::class);
        $user->shouldReceive('getAttribute')->with('id')->andReturn(1);

        $server = \Mockery::mock(Server::class);
        $server->shouldReceive('getAttribute')->with('billing_product_id')->andReturn($billingProductId);
        $server->shouldReceive('getAttribute')->with('billing_days')->andReturn(30);
        $server->shouldReceive('getAttribute')->with('user')->andReturn($user);
        $server->shouldReceive('getAttribute')->with('uuid')->andReturn('test-uuid-1234');
        $server->shouldReceive('isDeletionScheduled')->andReturn(false);

        // Set renewal date based on days overdue
        if ($daysOverdue > 0) {
            // Server is past due
            $renewalDate = Carbon::now()->subDays($daysOverdue);
        } else {
            // Server is not past due (has time remaining)
            $renewalDate = Carbon::now()->addDays(abs($daysOverdue));
        }

        $server->shouldReceive('getAttribute')->with('renewal_date')->andReturn($renewalDate);

        return $server;
    }

    /**
     * Create a mock product.
     */
    private function createMockProduct(bool $isFree, int $renewalDays): Product
    {
        $product = \Mockery::mock(Product::class);
        $product->shouldReceive('getAttribute')->with('id')->andReturn(123);
        $product->shouldReceive('getAttribute')->with('price')->andReturn($isFree ? 0.0 : 10.0);
        $product->shouldReceive('isFree')->andReturn($isFree);
        $product->shouldReceive('getRenewalDays')->andReturn($renewalDays);

        return $product;
    }

    /**
     * Create a mock order.
     */
    private function createMockOrder(): Order
    {
        $order = \Mockery::mock(Order::class);
        $order->shouldReceive('getAttribute')->with('id')->andReturn(456);
        $order->shouldReceive('getAttribute')->with('total')->andReturn(10.0);
        $order->shouldReceive('getAttribute')->with('name')->andReturn('Renewal Order ');

        return $order;
    }

    /**
     * Clean up after tests.
     */
    protected function tearDown(): void
    {
        \Mockery::close();
        parent::tearDown();
    }
}
