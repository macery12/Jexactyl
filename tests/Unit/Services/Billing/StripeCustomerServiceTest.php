<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Stripe\StripeClient;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\StripeCustomerService;

class StripeCustomerServiceTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'stripe_customer_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('users', function (Blueprint $table): void {
            $table->increments('id');
            $table->uuid('uuid')->unique();
            $table->string('username');
            $table->string('email');
            $table->string('stripe_id')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testDeletedCustomerIdIsRetainedUntilItsIdempotentReplacementIsPersisted(): void
    {
        $this->insertUser('cus_deleted');
        $observedParameters = null;
        $observedOptions = null;
        $customers = new class ($observedParameters, $observedOptions) {
            public function __construct(
                private mixed &$observedParameters,
                private mixed &$observedOptions,
            ) {
            }

            public function retrieve(string $id): object
            {
                return (object) ['id' => $id, 'deleted' => true];
            }

            public function create(array $parameters, array $options): object
            {
                $this->observedParameters = $parameters;
                $this->observedOptions = $options;

                if (DB::table('users')->where('id', 7)->value('stripe_id') !== 'cus_deleted') {
                    throw new \RuntimeException('The stale Customer ID was cleared before replacement.');
                }

                return (object) ['id' => 'cus_replacement'];
            }
        };

        $service = $this->serviceWithCustomers($customers);
        $result = $service->resolveForUser(User::query()->findOrFail(7));

        $this->assertSame('cus_replacement', $result);
        $this->assertSame('cus_replacement', DB::table('users')->where('id', 7)->value('stripe_id'));
        $this->assertSame(['metadata' => ['user_id' => '7']], $observedParameters);
        $this->assertSame(
            'billing-user-7-' . substr(hash('sha256', 'cus_deleted'), 0, 24),
            $observedOptions['idempotency_key']
        );
    }

    public function testConcurrentReplacementWinsOverAnOlderProviderResponse(): void
    {
        $this->insertUser('cus_deleted');
        $customers = new class () {
            public function retrieve(string $id): object
            {
                return (object) ['id' => $id, 'deleted' => true];
            }

            public function create(array $parameters, array $options): object
            {
                DB::table('users')->where('id', 7)->update(['stripe_id' => 'cus_concurrent']);

                return (object) ['id' => 'cus_loser'];
            }
        };

        $service = $this->serviceWithCustomers($customers);
        $result = $service->resolveForUser(User::query()->findOrFail(7));

        $this->assertSame('cus_concurrent', $result);
        $this->assertSame('cus_concurrent', DB::table('users')->where('id', 7)->value('stripe_id'));
    }

    private function insertUser(string $stripeId): void
    {
        DB::table('users')->insert([
            'id' => 7,
            'uuid' => 'b9f4a9ab-1521-48fa-bc74-8d536b2e265e',
            'username' => 'mutable-name',
            'email' => 'mutable@example.test',
            'stripe_id' => $stripeId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function serviceWithCustomers(object $customers): StripeCustomerService
    {
        $stripe = \Mockery::mock(StripeClient::class);
        $stripe->customers = $customers;

        $reflection = new \ReflectionClass(StripeCustomerService::class);
        /** @var StripeCustomerService $service */
        $service = $reflection->newInstanceWithoutConstructor();
        $property = $reflection->getProperty('stripe');
        $property->setValue($service, $stripe);

        return $service;
    }
}
