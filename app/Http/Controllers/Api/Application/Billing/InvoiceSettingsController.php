<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Everest\Models\Billing\InvoiceSettings;
use Everest\Services\Billing\InvoiceStorageService;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;

class InvoiceSettingsController extends ApplicationApiController
{
    public function __construct(
        private readonly InvoiceSettingsService $settingsService,
        private readonly InvoiceStorageService $storageService,
    ) {
        parent::__construct();
    }

    /**
     * Get current invoice settings.
     */
    public function show(Request $request): JsonResponse
    {
        $settings = $this->settingsService->get();

        return response()->json($this->transform($settings));
    }

    /**
     * Update invoice settings.
     */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'company_name' => 'nullable|string|max:255',
            'company_address' => 'nullable|string|max:255',
            'company_city' => 'nullable|string|max:100',
            'company_state' => 'nullable|string|max:100',
            'company_zip' => 'nullable|string|max:20',
            'company_country' => 'nullable|string|max:100',
            'company_logo_url' => 'nullable|url|max:500',
            'company_tax_id' => 'nullable|string|max:100',
            'invoice_prefix' => 'nullable|string|max:20|regex:/^[A-Z0-9\-]+$/',
            'auto_cleanup_enabled' => 'nullable|boolean',
            'auto_cleanup_after_years' => 'nullable|integer|min:1|max:100',
            'require_billing_address' => 'nullable|boolean',
            'storage_driver' => 'nullable|in:local,s3,r2',
            'storage_config' => 'nullable|array',
            'storage_config.key' => 'nullable|string',
            'storage_config.secret' => 'nullable|string',
            'storage_config.region' => 'nullable|string',
            'storage_config.bucket' => 'nullable|string',
            'storage_config.endpoint' => 'nullable|string',
            'storage_config.account_id' => 'nullable|string',
            'r2_bytes_limit' => 'nullable|integer|min:1',
        ]);

        $settings = $this->settingsService->update(array_filter($data, fn ($v) => $v !== null));

        return response()->json($this->transform($settings));
    }

    /**
     * Return current storage usage information.
     */
    public function storageUsage(Request $request): JsonResponse
    {
        $settings = $this->settingsService->get();

        $usage = [
            'driver' => $settings->storage_driver,
            'r2_bytes_used' => $settings->r2_bytes_used,
            'r2_bytes_limit' => $settings->r2_bytes_limit,
            'r2_percent_used' => $settings->r2_bytes_limit > 0
                ? round(($settings->r2_bytes_used / $settings->r2_bytes_limit) * 100, 2)
                : 0,
        ];

        // For local disk, calculate approximate usage
        if ($settings->storage_driver === 'local') {
            try {
                $invoicePath = storage_path('app/invoices');
                $bytes = 0;
                if (is_dir($invoicePath)) {
                    $iterator = new \RecursiveIteratorIterator(
                        new \RecursiveDirectoryIterator($invoicePath, \FilesystemIterator::SKIP_DOTS),
                        \RecursiveIteratorIterator::LEAVES_ONLY
                    );
                    foreach ($iterator as $file) {
                        if ($file->isFile()) {
                            $bytes += $file->getSize();
                        }
                    }
                }
                $usage['local_bytes_used'] = $bytes;
            } catch (\Throwable) {
                $usage['local_bytes_used'] = null;
            }
        }

        return response()->json($usage);
    }

    /**
     * Test the currently-saved storage configuration by writing and deleting a small probe file.
     */
    public function testConnection(Request $request): JsonResponse
    {
        $settings = $this->settingsService->get();

        try {
            $disk = $this->storageService->buildDisk($settings);

            $probe = 'invoices/.probe-' . uniqid() . '.txt';
            $disk->put($probe, 'connection-test');
            $exists = $disk->exists($probe);
            $disk->delete($probe);

            if (!$exists) {
                return response()->json([
                    'ok' => false,
                    'message' => 'File was written but could not be verified. Check bucket permissions.',
                ], 422);
            }

            $label = match ($settings->storage_driver) {
                'r2' => 'R2',
                's3' => 'S3',
                default => 'Local',
            };

            return response()->json([
                'ok' => true,
                'message' => "{$label} connection successful — bucket is reachable and writable.",
            ]);
        } catch (\RuntimeException $e) {
            return response()->json(['ok' => false, 'message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::warning("InvoiceSettings: storage connection test failed ({$settings->storage_driver}): " . $e->getMessage());

            $msg = $e->getMessage();
            if (str_contains($msg, 'InvalidAccessKeyId') || str_contains($msg, 'AuthorizationQueryParametersError')) {
                $msg = 'Invalid Access Key ID. Double-check your key.';
            } elseif (str_contains($msg, 'SignatureDoesNotMatch')) {
                $msg = 'Signature mismatch — the Secret Access Key is incorrect.';
            } elseif (str_contains($msg, 'NoSuchBucket') || str_contains($msg, 'BucketNotFound')) {
                $msg = 'Bucket not found. Check the bucket name and region/endpoint.';
            } elseif (str_contains($msg, 'AccessDenied') || str_contains($msg, 'Forbidden')) {
                $msg = 'Access denied. Ensure the API token has Object Read & Write permission on this bucket.';
            } elseif (str_contains($msg, 'Could not resolve host') || str_contains($msg, 'cURL error')) {
                $msg = 'Could not reach the endpoint. Check your Account ID or Endpoint URL.';
            }

            return response()->json(['ok' => false, 'message' => $msg], 422);
        }
    }

    private function transform(InvoiceSettings $settings): array
    {
        return [
            'company_name' => $settings->company_name,
            'company_address' => $settings->company_address,
            'company_city' => $settings->company_city,
            'company_state' => $settings->company_state,
            'company_zip' => $settings->company_zip,
            'company_country' => $settings->company_country,
            'company_logo_url' => $settings->company_logo_url,
            'company_tax_id' => $settings->company_tax_id,
            'invoice_prefix' => $settings->invoice_prefix,
            'invoice_sequence' => $settings->invoice_sequence,
            'auto_cleanup_enabled' => $settings->auto_cleanup_enabled,
            'auto_cleanup_after_years' => $settings->auto_cleanup_after_years,
            'require_billing_address' => $settings->require_billing_address ?? false,
            'storage_driver' => $settings->storage_driver,
            // Mask secrets in storage_config
            'storage_config' => $this->maskStorageConfig($settings->storage_config ?? []),
            'r2_bytes_used' => $settings->r2_bytes_used,
            'r2_bytes_limit' => $settings->r2_bytes_limit,
        ];
    }

    private function maskStorageConfig(array $config): array
    {
        $masked = $config;
        foreach (['secret', 'key', 'password'] as $field) {
            if (isset($masked[$field]) && $masked[$field] !== '') {
                $masked[$field] = '**redacted**';
            }
        }

        return $masked;
    }
}
