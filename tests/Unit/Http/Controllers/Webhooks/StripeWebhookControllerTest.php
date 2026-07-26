<?php

namespace Everest\Tests\Unit\Http\Controllers\Webhooks;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\StripeCaptureService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Http\Controllers\Webhooks\StripeWebhookController;

class StripeWebhookControllerTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'stripe_webhook_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->string('status');
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->timestamps();
        });

        DB::table('orders')->insert([
            'id' => 71,
            'user_id' => 9,
            'status' => Order::STATUS_PENDING,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('payment_transactions')->insert([
            'id' => 81,
            'order_id' => 71,
            'processor' => 'stripe',
            'external_id' => 'pi_recover',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testSucceededIntentRecordsCaptureThenResumesFulfillment(): void
    {
        $capture = \Mockery::mock(StripeCaptureService::class);
        $capture->shouldReceive('record')
            ->once()
            ->with(
                \Mockery::on(fn (Order $order) => $order->id === 71),
                \Mockery::on(fn ($transaction) => $transaction->id === 81),
                \Mockery::on(fn ($intent) => $intent->id === 'pi_recover'),
            );
        $fulfillment = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillment->shouldReceive('fulfillOrder')
            ->once()
            ->with(
                \Mockery::type(Request::class),
                \Mockery::on(fn (Order $order) => $order->id === 71),
            );

        $controller = new StripeWebhookController($capture, $fulfillment);
        $dispatch = new \ReflectionMethod($controller, 'dispatch');
        $dispatch->invoke($controller, $this->event());

        $this->addToAssertionCount(1);
    }

    public function testVerifiedProcessingFailureReturnsRetryableStatus(): void
    {
        $capture = \Mockery::mock(StripeCaptureService::class);
        $capture->shouldReceive('record')->once()->andThrow(new \RuntimeException('injected'));
        $fulfillment = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillment->shouldNotReceive('fulfillOrder');
        $controller = new StripeWebhookController($capture, $fulfillment);

        $secret = 'whsec_test_retry';
        config()->set('services.stripe.webhook_secret', $secret);
        $payload = json_encode($this->event()->toArray(), JSON_THROW_ON_ERROR);
        $timestamp = time();
        $signature = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        $request = Request::create('/api/webhooks/stripe', 'POST', [], [], [], [], $payload);
        $request->headers->set('Stripe-Signature', "t={$timestamp},v1={$signature}");

        $response = $controller->handle($request);

        $this->assertSame(500, $response->getStatusCode());
    }

    private function event(): \Stripe\Event
    {
        return \Stripe\Event::constructFrom([
            'id' => 'evt_recover',
            'object' => 'event',
            'type' => 'payment_intent.succeeded',
            'data' => [
                'object' => [
                    'id' => 'pi_recover',
                    'object' => 'payment_intent',
                ],
            ],
        ]);
    }
}
