<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Billing;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Invoice;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\InvoicePdfService;

class InvoiceControllerTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'invoice_controller_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database for invoice controller test.');
        }
        $this->dbPath = $dbPath;

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('invoices', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedBigInteger('order_id');
            $table->unsignedInteger('user_id');
            $table->string('invoice_number', 30)->unique();
            $table->string('status', 20);
            $table->string('data_path')->nullable();
            $table->string('data_disk', 20)->nullable();
            $table->unsignedBigInteger('data_size_bytes')->nullable();
            $table->string('pdf_cached_path')->nullable();
            $table->timestamp('pdf_cached_at')->nullable();
            $table->timestamp('pdf_expires_at')->nullable();
            $table->decimal('total', 10, 2);
            $table->string('currency', 10);
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->unsignedInteger('voided_by')->nullable();
            $table->string('voided_reason')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testBrowserDownloadRequestRedirectsToPdf(): void
    {
        [$controller, $request, $invoice] = $this->downloadRequest('text/html');

        $response = $controller->download($request, $invoice->uuid);

        $this->assertInstanceOf(RedirectResponse::class, $response);
        $this->assertSame(
            url("/api/client/billing/invoices/{$invoice->uuid}/serve"),
            $response->getTargetUrl()
        );
    }

    public function testApiDownloadRequestStillReturnsPdfUrlAsJson(): void
    {
        [$controller, $request, $invoice] = $this->downloadRequest('application/json');

        $response = $controller->download($request, $invoice->uuid);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertSame([
            'url' => url("/api/client/billing/invoices/{$invoice->uuid}/serve"),
            'expires_in' => 86400,
        ], $response->getData(true));
    }

    /**
     * @return array{0: \Everest\Http\Controllers\Api\Client\Billing\InvoiceController, 1: Request, 2: Invoice}
     */
    private function downloadRequest(string $accept): array
    {
        $invoice = Invoice::create([
            'uuid' => '3c6e2a70-8be2-4b8e-b2d5-ebc6a976d453',
            'order_id' => 1,
            'user_id' => 7,
            'invoice_number' => 'INV-0001',
            'status' => Invoice::STATUS_ACTIVE,
            'data_path' => 'invoices/INV-0001.json.enc',
            'data_disk' => 'local',
            'total' => 12.34,
            'currency' => 'USD',
        ]);

        $request = Request::create(
            "/api/client/billing/invoices/{$invoice->uuid}/download",
            'GET',
            [],
            [],
            [],
            ['HTTP_ACCEPT' => $accept]
        );
        $this->app->instance('request', $request);
        $this->app->instance(Request::class, $request);

        $pdfService = \Mockery::mock(InvoicePdfService::class);
        $pdfService->shouldReceive('getOrGenerate')
            ->once()
            ->with(\Mockery::type(Invoice::class))
            ->andReturn('%PDF-1.4');

        $controller = new \Everest\Http\Controllers\Api\Client\Billing\InvoiceController($pdfService);
        $request->setUserResolver(fn () => (object) ['id' => 7]);

        return [$controller, $request, $invoice];
    }
}
