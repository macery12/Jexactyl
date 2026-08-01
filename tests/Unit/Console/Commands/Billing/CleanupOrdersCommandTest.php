<?php

namespace Everest\Tests\Unit\Console\Commands\Billing;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\ServerFulfillmentService;

class CleanupOrdersCommandTest extends TestCase
{
    private string $dbPath;

    private ServerFulfillmentService $fulfillmentService;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'cleanup_orders_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->string('status');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id')->nullable();
            $table->timestamp('fulfillment_started_at')->nullable();
            $table->timestamps();
        });

        $this->fulfillmentService = \Mockery::mock(ServerFulfillmentService::class);
        $this->app->instance(ServerFulfillmentService::class, $this->fulfillmentService);
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->string('processor')->nullable();
            $table->string('external_id')->nullable();
            $table->string('status')->nullable();
            $table->string('capture_id')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->string('provider_negative_status')->nullable();
            $table->timestamp('provider_negative_at')->nullable();
            $table->json('provider_negative_events')->nullable();
            $table->timestamps();
        });
        Schema::create('paypal_webhook_events', function (Blueprint $table): void {
            $table->id();
            $table->string('transmission_id')->unique();
            $table->char('payload_hash', 64);
            $table->string('event_type')->nullable();
            $table->string('paypal_order_id')->nullable()->index();
            $table->string('status');
            $table->unsignedInteger('attempts')->default(1);
            $table->text('last_error')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testDeletionRetainsLinkedAndProviderNegativeEvidence(): void
    {
        $this->fulfillmentService->shouldNotReceive('fulfillOrder');
        $old = now()->subDays(60);
        DB::table('orders')->insert([
            [
                'id' => 1,
                'status' => Order::STATUS_EXPIRED,
                'user_id' => 9,
                'server_id' => null,
                'fulfillment_started_at' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'id' => 2,
                'status' => Order::STATUS_EXPIRED,
                'user_id' => 9,
                'server_id' => 88,
                'fulfillment_started_at' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'id' => 3,
                'status' => Order::STATUS_EXPIRED,
                'user_id' => 9,
                'server_id' => null,
                'fulfillment_started_at' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
        ]);
        DB::table('payment_transactions')->insert([
            [
                'order_id' => 1,
                'provider_negative_status' => 'PAYMENT.CAPTURE.REFUNDED',
                'provider_negative_at' => $old,
                'provider_negative_events' => json_encode(
                    [['event_id' => 'WH-NEGATIVE']],
                    JSON_THROW_ON_ERROR
                ),
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'order_id' => 3,
                'provider_negative_status' => null,
                'provider_negative_at' => null,
                'provider_negative_events' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
        ]);

        $this->artisan('p:billing:cleanup-orders', [
            '--hours' => 24,
            '--delete-after' => 24,
        ])->assertExitCode(0);

        $this->assertDatabaseHas('orders', ['id' => 1]);
        $this->assertDatabaseHas('orders', ['id' => 2]);
        $this->assertDatabaseMissing('orders', ['id' => 3]);
    }

    public function testStaleCapturedFulfillmentIsResumedByTheScheduledCommand(): void
    {
        $old = now()->subHour();
        DB::table('orders')->insert([
            'id' => 4,
            'status' => Order::STATUS_FULFILLING,
            'user_id' => 9,
            'server_id' => null,
            'fulfillment_started_at' => $old,
            'created_at' => $old,
            'updated_at' => $old,
        ]);
        DB::table('payment_transactions')->insert([
            'order_id' => 4,
            'capture_id' => 'CAPTURE-4',
            'captured_at' => $old,
            'provider_negative_status' => null,
            'provider_negative_at' => null,
            'provider_negative_events' => null,
            'created_at' => $old,
            'updated_at' => $old,
        ]);

        $this->fulfillmentService->shouldReceive('fulfillOrder')
            ->once()
            ->with(
                \Mockery::type(Request::class),
                \Mockery::on(fn (Order $order) => $order->id === 4),
            );

        $this->artisan('p:billing:cleanup-orders')->assertExitCode(0);
    }

    public function testUnresolvedVerifiedPayPalEventsPreventExpirationAndDeletion(): void
    {
        $this->fulfillmentService->shouldNotReceive('fulfillOrder');
        $old = now()->subDays(60);

        DB::table('orders')->insert([
            [
                'id' => 5,
                'status' => Order::STATUS_PENDING,
                'user_id' => 9,
                'server_id' => null,
                'fulfillment_started_at' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'id' => 6,
                'status' => Order::STATUS_EXPIRED,
                'user_id' => 9,
                'server_id' => null,
                'fulfillment_started_at' => null,
                'created_at' => $old,
                'updated_at' => $old,
            ],
        ]);
        DB::table('payment_transactions')->insert([
            [
                'order_id' => 5,
                'processor' => 'paypal',
                'external_id' => 'PAYPAL-ORDER-5',
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'order_id' => 6,
                'processor' => 'paypal',
                'external_id' => 'PAYPAL-ORDER-6',
                'created_at' => $old,
                'updated_at' => $old,
            ],
        ]);
        DB::table('paypal_webhook_events')->insert([
            [
                'transmission_id' => 'TRANS-5',
                'payload_hash' => hash('sha256', 'event-5'),
                'paypal_order_id' => 'PAYPAL-ORDER-5',
                'status' => 'failed',
                'attempts' => 1,
                'created_at' => $old,
                'updated_at' => $old,
            ],
            [
                'transmission_id' => 'TRANS-6',
                'payload_hash' => hash('sha256', 'event-6'),
                'paypal_order_id' => 'PAYPAL-ORDER-6',
                'status' => 'processing',
                'attempts' => 1,
                'created_at' => $old,
                'updated_at' => $old,
            ],
        ]);

        $this->artisan('p:billing:cleanup-orders', [
            '--hours' => 24,
            '--delete-after' => 24,
        ])->assertExitCode(0);

        $this->assertDatabaseHas('orders', ['id' => 5, 'status' => Order::STATUS_PENDING]);
        $this->assertDatabaseHas('orders', ['id' => 6, 'status' => Order::STATUS_EXPIRED]);
    }
}
