<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\CheckoutSnapshotService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\CheckoutIntegrityService;

class CheckoutSnapshotServiceTest extends TestCase
{
    private string $dbPath;
    private CheckoutSnapshotService $service;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'checkout_snapshot_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create checkout snapshot test database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);
        config()->set('app.key', 'base64:' . base64_encode(str_repeat('k', 32)));

        Schema::create('orders', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('product_id');
            $table->string('payment_processor');
            $table->uuid('checkout_nonce')->nullable();
            $table->char('checkout_request_fingerprint', 64)->nullable();
            $table->char('checkout_fingerprint', 64)->nullable();
            $table->timestamp('checkout_locked_at')->nullable();
            $table->string('status');
            $table->timestamps();
        });

        $this->service = new CheckoutSnapshotService(
            \Mockery::mock(BillingValidationService::class),
            \Mockery::mock(CheckoutIntegrityService::class),
        );
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testNonceResumesOnlyTheExactPendingLogicalRequest(): void
    {
        $user = new User();
        $user->id = 7;
        $product = new Product();
        $product->id = 11;
        $request = Request::create('/checkout', 'POST', [
            'checkout_nonce' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'name' => 'Locked server',
            'node_id' => 3,
            'billing_days' => 30,
            'variables' => ['TOKEN' => 'sentinel-secret', 'MODE' => 'safe'],
        ]);
        $fingerprint = $this->service->requestFingerprint(
            $request,
            $user,
            $product,
            'stripe',
        );
        $this->assertSame(64, strlen($fingerprint));
        $this->assertStringNotContainsString('sentinel-secret', $fingerprint);

        DB::table('orders')->insert([
            'id' => 1,
            'user_id' => 7,
            'product_id' => 11,
            'payment_processor' => 'stripe',
            'checkout_nonce' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'checkout_request_fingerprint' => $fingerprint,
            'checkout_fingerprint' => str_repeat('f', 64),
            'checkout_locked_at' => now(),
            'status' => Order::STATUS_PENDING,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $resolved = $this->service->existingForRequest(
            $request,
            $user,
            $product,
            'stripe',
            $fingerprint,
        );
        $this->assertSame(1, $resolved?->id);

        $changed = Request::create('/checkout', 'POST', array_merge(
            $request->all(),
            ['name' => 'Different server'],
        ));
        $changedFingerprint = $this->service->requestFingerprint(
            $changed,
            $user,
            $product,
            'stripe',
        );

        $this->expectException(DisplayException::class);
        $this->service->existingForRequest(
            $changed,
            $user,
            $product,
            'stripe',
            $changedFingerprint,
        );
    }

    public function testNonceCannotBeReusedAcrossProcessors(): void
    {
        $user = new User();
        $user->id = 7;
        $product = new Product();
        $product->id = 11;
        $request = Request::create('/checkout', 'POST', [
            'checkout_nonce' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'name' => 'Locked server',
            'node_id' => 3,
        ]);
        $stripeFingerprint = $this->service->requestFingerprint(
            $request,
            $user,
            $product,
            'stripe',
        );
        DB::table('orders')->insert([
            'user_id' => 7,
            'product_id' => 11,
            'payment_processor' => 'stripe',
            'checkout_nonce' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'checkout_request_fingerprint' => $stripeFingerprint,
            'checkout_fingerprint' => str_repeat('f', 64),
            'checkout_locked_at' => now(),
            'status' => Order::STATUS_PENDING,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $paypalFingerprint = $this->service->requestFingerprint(
            $request,
            $user,
            $product,
            'paypal',
        );

        $this->expectException(DisplayException::class);
        $this->service->existingForRequest(
            $request,
            $user,
            $product,
            'paypal',
            $paypalFingerprint,
        );
    }

    public function testProviderCheckoutCannotBeCreatedWithoutNonce(): void
    {
        $user = new User();
        $user->id = 7;
        $product = new Product();
        $product->id = 11;
        $request = Request::create('/checkout', 'POST', ['name' => 'Server']);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('checkout identifier is required');

        $this->service->existingForRequest(
            $request,
            $user,
            $product,
            'stripe',
            $this->service->requestFingerprint($request, $user, $product, 'stripe'),
        );
    }
}
