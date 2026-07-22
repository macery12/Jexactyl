<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Invoice;
use Spatie\QueryBuilder\QueryBuilder;
use Everest\Services\Billing\InvoicePdfService;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;

class InvoiceController extends ClientApiController
{
    public function __construct(private readonly InvoicePdfService $pdfService)
    {
        parent::__construct();
    }

    /**
     * List the authenticated user's invoices.
     */
    public function index(Request $request): array
    {
        $perPage = (int) $request->query('per_page', '20');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $invoices = QueryBuilder::for(
            Invoice::query()
                    ->where('user_id', $request->user()->id)
                    ->with('order')
        )
            ->allowedFilters(...['status'])
            ->allowedSorts(...['generated_at', 'total'])
            ->defaultSort('-generated_at')
            ->paginate($perPage);

        return $this->fractal->collection($invoices)
            ->transformWith(fn (Invoice $inv) => $this->transformInvoice($inv))
            ->withResourceName('invoice')
            ->toArray();
    }

    /**
     * Ensure a PDF is ready and return a controller-served download URL.
     * PDF is generated on demand if the local cache has expired.
     */
    public function download(Request $request, string $uuid): JsonResponse
    {
        $invoice = Invoice::where('uuid', $uuid)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        if (!$invoice->isDownloadable()) {
            return response()->json(['error' => 'This invoice is no longer available for download.'], 422);
        }

        try {
            $this->pdfService->getOrGenerate($invoice);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to generate PDF: ' . $e->getMessage()], 500);
        }

        $url = url("/api/client/billing/invoices/{$uuid}/serve");

        return response()->json(['url' => $url, 'expires_in' => 86400]);
    }

    /**
     * Stream the PDF to the browser. Generates on demand if cache expired.
     */
    public function serve(Request $request, string $uuid): \Illuminate\Http\Response
    {
        $invoice = Invoice::where('uuid', $uuid)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

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

    private function transformInvoice(Invoice $invoice): array
    {
        return [
            'uuid' => $invoice->uuid,
            'invoice_number' => $invoice->invoice_number,
            'status' => $invoice->status,
            'total' => $invoice->total,
            'currency' => $invoice->currency,
            'generated_at' => $invoice->generated_at?->toIso8601String(),
            'has_cached_pdf' => $invoice->hasCachedPdf(),
            'order_id' => $invoice->order_id,
            'order_type' => $invoice->order?->type,
            'is_downloadable' => $invoice->isDownloadable(),
        ];
    }
}
