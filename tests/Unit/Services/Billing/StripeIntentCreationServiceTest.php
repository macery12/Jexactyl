<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\StripeCustomerService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\StripeIntentCreationService;

class StripeIntentCreationServiceTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'stripe_intent_ledger_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('product_id');
            $table->string('status');
            $table->string('checkout_request_fingerprint');
            $table->string('checkout_fingerprint');
            $table->string('checkout_currency', 3);
            $table->unsignedBigInteger('checkout_amount_minor');
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->string('provider_customer_id')->nullable();
            $table->json('raw_metadata')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testRetryReusesThePersistedProviderPayloadAfterConfigurationChanges(): void
    {
        $now = now();
        DB::table('orders')->insert([
            'id' => 17,
            'user_id' => 9,
            'product_id' => 4,
            'status' => Order::STATUS_PENDING,
            'checkout_request_fingerprint' => str_repeat('a', 64),
            'checkout_fingerprint' => str_repeat('b', 64),
            'checkout_currency' => 'USD',
            'checkout_amount_minor' => 1999,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('payment_transactions')->insert([
            'id' => 23,
            'order_id' => 17,
            'processor' => 'stripe',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $customer = \Mockery::mock(StripeCustomerService::class);
        $customer->shouldReceive('resolveForUser')->once()->andReturn('cus_frozen');
        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('minorAmount')->andReturn(1999);
        $integrity->shouldReceive('currency')->andReturn('USD');
        $integrity->shouldReceive('stripeMetadata')->andReturn([
            'order_id' => '17',
            'product_id' => '4',
            'checkout_fingerprint' => str_repeat('b', 64),
        ]);

        $service = new StripeIntentCreationService($customer, $integrity);
        $order = Order::query()->findOrFail(17);
        $user = new User();
        $user->id = 9;

        config()->set('modules.billing.paypal', false);
        config()->set('modules.billing.link', false);
        $first = $service->parameters($order, $user);

        config()->set('modules.billing.paypal', true);
        config()->set('modules.billing.link', true);
        $second = $service->parameters($order, $user);

        $this->assertSame($first, $second);
        $this->assertSame(['card'], $second['payment_method_types']);
        $this->assertSame('cus_frozen', $second['customer']);
        $this->assertSame(
            $first,
            DB::table('payment_transactions')
                ->where('id', 23)
                ->value('raw_metadata') === null
                    ? null
                    : json_decode(
                        (string) DB::table('payment_transactions')
                            ->where('id', 23)
                            ->value('raw_metadata'),
                        true,
                        512,
                        JSON_THROW_ON_ERROR
                    )['stripe_intent_create']
        );
        $this->assertSame(
            'cus_frozen',
            DB::table('payment_transactions')->where('id', 23)->value('provider_customer_id')
        );
    }
}
