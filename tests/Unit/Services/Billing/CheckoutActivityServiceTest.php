<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\ActivityLog;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\CheckoutActivityService;

class CheckoutActivityServiceTest extends TestCase
{
    private string $dbPath;

    private CheckoutActivityService $service;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'checkout_activity_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create checkout activity test database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);
        config()->set('activity.enabled.admin', true);
        config()->set('modules.webhooks.enabled', false);

        Schema::create('activity_logs', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->char('batch', 36)->nullable();
            $table->string('event');
            $table->string('ip')->nullable();
            $table->text('description')->nullable();
            $table->string('actor_type')->nullable();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->unsignedBigInteger('server_id')->nullable();
            $table->unsignedInteger('api_key_id')->nullable();
            $table->json('properties');
            $table->timestamp('timestamp')->useCurrent();
            $table->boolean('is_admin')->default(0);
            $table->string('scope')->nullable();
        });
        Schema::create('activity_log_subjects', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('activity_log_id');
            $table->string('subject_type');
            $table->unsignedBigInteger('subject_id');
        });
        Schema::create('nodes', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('name');
        });
        Schema::create('products', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('name');
        });
        Schema::create('users', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('uuid');
            $table->string('username');
            $table->string('email');
            $table->softDeletes();
        });

        DB::table('nodes')->insert(['id' => 3, 'name' => 'frankfurt-1']);
        DB::table('products')->insert(['id' => 7, 'name' => 'Minecraft 8GB']);
        DB::table('users')->insert([
            'id' => 9,
            'uuid' => '11111111-2222-3333-4444-555555555555',
            'username' => 'buyer',
            'email' => 'buyer@example.com',
        ]);

        $this->service = $this->app->make(CheckoutActivityService::class);
    }

    public function tearDown(): void
    {
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testNewCheckoutIsRecordedWithNodeAndPaymentDetail(): void
    {
        $this->service->recordFulfilled($this->order(Order::TYPE_NEW), $this->server());

        $log = ActivityLog::query()->firstOrFail();

        $this->assertSame(ActivityLog::EVENT_CHECKOUT_COMPLETED, $log->event);
        $this->assertSame(
            'Provisioned "survival" on frankfurt-1 — Minecraft 8GB, 12.00 EUR via Stripe',
            $log->description,
        );
        $this->assertSame(42, $log->properties->get('order_id'));
        $this->assertSame('frankfurt-1', $log->properties->get('node'));
        $this->assertSame(8192, $log->properties->get('memory_mib'));
        $this->assertSame(21, $log->server_id);
        // Webhook fulfillment has no authenticated user, so the buyer must be
        // attached explicitly rather than the entry landing on "system".
        $this->assertSame(9, $log->actor_id);
        $this->assertSame((new User())->getMorphClass(), $log->actor_type);
    }

    public function testRenewalAndPlanChangeUseDistinctEvents(): void
    {
        $this->service->recordFulfilled($this->order(Order::TYPE_REN), $this->server());
        $this->service->recordFulfilled($this->order(Order::TYPE_UPG), $this->server());

        $this->assertSame(
            [ActivityLog::EVENT_CHECKOUT_RENEWED, ActivityLog::EVENT_CHECKOUT_UPGRADED],
            ActivityLog::query()->orderBy('id')->pluck('event')->all(),
        );
    }

    public function testFreeCheckoutReportsNoCharge(): void
    {
        $order = $this->order(Order::TYPE_NEW);
        $order->payment_processor = 'free';
        $order->total = 0.0;

        $this->service->recordFulfilled($order, $this->server());

        $this->assertStringEndsWith('Minecraft 8GB, no charge', ActivityLog::query()->firstOrFail()->description);
    }

    /**
     * The entry is attributed to the customer and carries no admin privilege,
     * yet still has to reach the administrative feed.
     */
    public function testEntryIsAdminVisibleDespiteBelongingToTheCustomer(): void
    {
        $this->service->recordFulfilled($this->order(Order::TYPE_NEW), $this->server());

        $log = ActivityLog::query()->firstOrFail();
        $this->assertFalse((bool) $log->is_admin);
        $this->assertSame('server', $log->scope);
        $this->assertTrue(ActivityLog::query()->adminVisible()->whereKey($log->id)->exists());
    }

    public function testNothingIsRecordedWhenAdminActivityIsDisabled(): void
    {
        config()->set('activity.enabled.admin', false);

        $this->service->recordFulfilled($this->order(Order::TYPE_NEW), $this->server());

        $this->assertSame(0, ActivityLog::query()->count());
    }

    /**
     * A checkout entry is bookkeeping written after the payment is captured and
     * the server exists, so a failure to build it must stay contained.
     */
    public function testRecordingNeverThrows(): void
    {
        Schema::drop('activity_logs');

        $this->service->recordFulfilled($this->order(Order::TYPE_NEW), $this->server());

        $this->assertTrue(true);
    }

    private function order(string $type): Order
    {
        $order = new Order();
        $order->forceFill([
            'id' => 42,
            'user_id' => 9,
            'type' => $type,
            'payment_processor' => 'stripe',
            'total' => 12.0,
            'checkout_currency' => 'eur',
            'product_id' => 7,
            'product_name' => null,
            'billing_days' => 30,
            'coupon_id' => null,
        ]);

        return $order;
    }

    private function server(): Server
    {
        $server = new Server();
        $server->forceFill([
            'id' => 21,
            'uuid' => 'd3b07384-d9a0-4f1e-bf3a-1c2d3e4f5a6b',
            'name' => 'survival',
            'node_id' => 3,
            'owner_id' => 9,
            'memory' => 8192,
            'disk' => 51200,
            'cpu' => 200,
        ]);
        $server->exists = true;

        return $server;
    }
}
