<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Invoice;
use Illuminate\Support\Facades\Log;
use Spatie\QueryBuilder\QueryBuilder;
use Spatie\QueryBuilder\AllowedFilter;
use Everest\Events\Email\PaymentReceived;
use Illuminate\Database\Eloquent\Builder;
use Everest\Services\Billing\InvoicePdfService;
use Everest\Services\Billing\InvoiceStorageService;
use Everest\Services\Billing\InvoiceGenerationService;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;

class InvoiceController extends ApplicationApiController
{
    public function __construct(
        private readonly InvoiceGenerationService $generationService,
        private readonly InvoiceStorageService $storageService,
        private readonly InvoicePdfService $pdfService,
    ) {
        parent::__construct();
    }

    /**
     * List all invoices with filtering and pagination.
     */
    public function index(Request $request): array
    {
        $perPage = (int) $request->query('per_page', '25');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $invoices = QueryBuilder::for(Invoice::query()->with(['user', 'order']))
            ->allowedFilters(...[
                'status',
                'currency',
                AllowedFilter::callback('user_id', function (Builder $query, $value) {
                    $query->where('user_id', $value);
                }),
                AllowedFilter::callback('search', function (Builder $query, $value) {
                    $query->where(function ($q) use ($value) {
                        $q->where('invoice_number', 'LIKE', "%{$value}%")
                          ->orWhereHas('user', function ($q) use ($value) {
                              $q->where('username', 'LIKE', "%{$value}%")
                                ->orWhere('email', 'LIKE', "%{$value}%");
                          });
                    });
                }),
                AllowedFilter::callback('date_from', function (Builder $query, $value) {
                    $query->where('generated_at', '>=', $value);
                }),
                AllowedFilter::callback('date_to', function (Builder $query, $value) {
                    $query->where('generated_at', '<=', $value);
                }),
            ])
            ->allowedSorts(...['generated_at', 'total', 'invoice_number', 'status'])
            ->defaultSort('-generated_at')
            ->paginate($perPage);

        return $this->fractal->collection($invoices)
            ->transformWith($this->buildTransformer())
            ->withResourceName('invoice')
            ->toArray();
    }

    /**
     * Get a single invoice.
     */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $invoice = Invoice::with(['user', 'order'])->where('uuid', $uuid)->firstOrFail();

        return response()->json($this->transformInvoice($invoice));
    }

    /**
     * Get a download URL for the invoice.
     * Generates (or serves from cache) the PDF on demand.
     */
    public function download(Request $request, string $uuid): JsonResponse
    {
        $invoice = Invoice::where('uuid', $uuid)->firstOrFail();

        if (!$invoice->isDownloadable()) {
            return response()->json(['error' => 'Invoice is not available for download.'], 422);
        }

        try {
            // Ensure a valid cached PDF exists (generates if cache expired or missing)
            $this->pdfService->getOrGenerate($invoice);
            $invoice->refresh();
        } catch (\Throwable $e) {
            Log::error("InvoiceController: PDF generation failed for {$uuid}: " . $e->getMessage());

            return response()->json(['error' => 'Failed to generate PDF: ' . $e->getMessage()], 500);
        }

        $url = url("/api/application/billing/invoices/{$uuid}/serve");

        return response()->json(['url' => $url, 'expires_in' => 86400]);
    }

    /**
     * Stream the PDF for the given invoice (admin route).
     * On-demand generates the PDF if cache has expired.
     */
    public function serve(Request $request, string $uuid): \Illuminate\Http\Response
    {
        $invoice = Invoice::where('uuid', $uuid)->firstOrFail();

        if (!$invoice->isDownloadable()) {
            abort(422, 'Invoice is not available for download.');
        }

        try {
            $content = $this->pdfService->getOrGenerate($invoice);
        } catch (\Throwable $e) {
            abort(500, 'Failed to generate PDF: ' . $e->getMessage());
        }

        return response($content, 200)
            ->header('Content-Type', 'application/pdf')
            ->header('Content-Disposition', 'attachment; filename="' . $invoice->invoice_number . '.pdf"');
    }

    /**
     * Void an invoice.
     */
    public function void(Request $request, string $uuid): JsonResponse
    {
        $request->validate(['reason' => 'nullable|string|max:500']);

        $invoice = Invoice::where('uuid', $uuid)->firstOrFail();

        if ($invoice->status === Invoice::STATUS_VOID) {
            return response()->json(['error' => 'Invoice is already void.'], 422);
        }

        $invoice->update([
            'status' => Invoice::STATUS_VOID,
            'voided_at' => now(),
            'voided_by' => $request->user()->id,
            'voided_reason' => $request->input('reason'),
        ]);

        Log::info("Invoice {$invoice->uuid} voided by admin {$request->user()->id}");

        return response()->json($this->transformInvoice($invoice->fresh()));
    }

    /**
     * Regenerate the encrypted data snapshot for an invoice (rebuilds from current order data)
     * and evicts any stale PDF cache so the next download gets a fresh PDF.
     */
    public function regenerate(Request $request, string $uuid): JsonResponse
    {
        $invoice = Invoice::with(['order', 'user'])->where('uuid', $uuid)->firstOrFail();

        if ($invoice->status === Invoice::STATUS_VOID) {
            return response()->json(['error' => 'Cannot regenerate a voided invoice.'], 422);
        }

        $order = $invoice->order;
        if (!$order) {
            return response()->json(['error' => 'Associated order not found.'], 422);
        }

        try {
            // Delete old snapshot file from remote storage
            $this->storageService->delete($invoice);

            // Evict any cached PDF so the next download regenerates from fresh data
            if ($invoice->pdf_cached_path) {
                $this->pdfService->evictInvoiceCache($invoice);
                $invoice->refresh();
            }

            // Re-generate the snapshot (new invoice record will be created inside generate())
            $newInvoice = $this->generationService->generate($order);

            // Absorb the new snapshot into the existing invoice record, keeping the invoice number
            $invoice->update([
                'data_path' => $newInvoice->data_path,
                'data_disk' => $newInvoice->data_disk,
                'data_size_bytes' => $newInvoice->data_size_bytes,
                'status' => Invoice::STATUS_ACTIVE,
                'generated_at' => now(),
                'expires_at' => null,
                'voided_at' => null,
                'voided_by' => null,
                'voided_reason' => null,
            ]);

            // Delete the extra invoice row that generate() created
            $newInvoice->delete();
        } catch (\Throwable $e) {
            Log::error("Failed to regenerate invoice {$invoice->uuid}: " . $e->getMessage());

            return response()->json(['error' => 'Failed to regenerate invoice: ' . $e->getMessage()], 500);
        }

        Log::info("Invoice {$invoice->uuid} snapshot regenerated by admin {$request->user()->id}");

        return response()->json($this->transformInvoice($invoice->fresh()));
    }

    /**
     * Resend the invoice email. Generates a fresh cached PDF if needed before sending.
     */
    public function resend(Request $request, string $uuid): JsonResponse
    {
        $invoice = Invoice::with(['order.user', 'order'])->where('uuid', $uuid)->firstOrFail();

        if (!$invoice->isDownloadable()) {
            return response()->json(['error' => 'Invoice data is not available.'], 422);
        }

        $order = $invoice->order;
        if (!$order || !$order->user) {
            return response()->json(['error' => 'Order or user not found.'], 422);
        }

        try {
            // Ensure a valid cached PDF exists for the email attachment
            $this->pdfService->getOrGenerate($invoice);
            $invoice->refresh();

            $invoiceAbsPath = $this->pdfService->cachedAbsolutePath($invoice);
            $downloadUrl = url("/api/client/billing/invoices/{$invoice->uuid}/download");

            event(new PaymentReceived(
                user: $order->user,
                amount: $order->total,
                currency: strtoupper($order->paypal_currency ?? config('modules.billing.currency.code', 'USD')),
                paymentMethod: match ($order->payment_processor) {
                    'stripe' => 'Stripe',
                    'paypal' => 'PayPal',
                    'free' => 'Free',
                    default => 'Unknown',
                },
                invoiceId: $invoice->invoice_number,
                correlationId: Str::uuid()->toString(),
                isRenewal: $order->type === Order::TYPE_REN,
                invoiceDownloadUrl: $downloadUrl,
                invoiceFilePath: $invoiceAbsPath,
                invoiceFileDisk: null,
                invoiceFileName: $invoice->invoice_number . '.pdf',
            ));

            Log::info("Invoice {$invoice->uuid} email resent by admin {$request->user()->id}");
        } catch (\Throwable $e) {
            Log::error("Failed to resend invoice email {$invoice->uuid}: " . $e->getMessage());

            return response()->json(['error' => 'Failed to resend email: ' . $e->getMessage()], 500);
        }

        return response()->json(['message' => 'Invoice email queued for delivery.']);
    }

    private function transformInvoice(Invoice $invoice): array
    {
        return [
            'uuid' => $invoice->uuid,
            'invoice_number' => $invoice->invoice_number,
            'status' => $invoice->status,
            'data_disk' => $invoice->data_disk,
            'data_size_bytes' => $invoice->data_size_bytes,
            'has_cached_pdf' => $invoice->hasCachedPdf(),
            'pdf_expires_at' => $invoice->pdf_expires_at?->toIso8601String(),
            'total' => $invoice->total,
            'currency' => $invoice->currency,
            'generated_at' => $invoice->generated_at?->toIso8601String(),
            'expires_at' => $invoice->expires_at?->toIso8601String(),
            'voided_at' => $invoice->voided_at?->toIso8601String(),
            'voided_reason' => $invoice->voided_reason,
            'order_id' => $invoice->order_id,
            'user' => $invoice->user ? [
                'id' => $invoice->user->id,
                'username' => $invoice->user->username,
                'email' => $invoice->user->email,
            ] : null,
            'is_downloadable' => $invoice->isDownloadable(),
        ];
    }

    private function buildTransformer(): \Closure
    {
        return fn (Invoice $invoice) => $this->transformInvoice($invoice);
    }
}
