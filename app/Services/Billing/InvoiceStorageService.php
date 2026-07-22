<?php

namespace Everest\Services\Billing;

use Everest\Models\Billing\Invoice;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Everest\Models\Billing\InvoiceSettings;
use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Handles all remote-storage I/O for invoice data snapshots.
 *
 * Invoice data is stored as AES-256 encrypted JSON blobs (.enc files) on the
 * configured storage driver (local, S3, or R2). The encryption is handled by
 * InvoiceEncryptionService using the INVOICE_ENCRYPTION_KEY env var.
 *
 * PDFs are NOT stored here — they are generated on demand and cached locally
 * by InvoicePdfService.
 */
class InvoiceStorageService
{
    public function __construct(
        private readonly InvoiceSettingsService $settingsService,
        private readonly InvoiceEncryptionService $encryption,
    ) {
    }

    /**
     * Encrypt a data snapshot and persist it to the configured storage driver.
     *
     * @param array $snapshot Plain-PHP array containing all invoice data (PII included)
     * @param string $invoiceNumber e.g. "INV-2026-000001"
     *
     * @return array{path: string, disk: string, size_bytes: int}
     *
     * @throws \RuntimeException if storage config is incomplete or R2 limit would be exceeded
     */
    public function storeData(array $snapshot, string $invoiceNumber): array
    {
        $settings = $this->settingsService->get();
        $diskName = $settings->storage_driver;

        $encrypted = $this->encryption->encryptArray($snapshot);
        $bytes = strlen($encrypted);

        $path = 'invoices/' . date('Y') . '/' . $invoiceNumber . '.enc';

        if ($diskName === 'r2') {
            $this->enforceR2Limit($settings, $bytes);
        }

        $this->buildDisk($settings)->put($path, $encrypted, [
            'ContentType' => 'application/octet-stream',
        ]);

        if ($diskName === 'r2') {
            $this->settingsService->incrementR2Usage($bytes);
        }

        return [
            'path' => $path,
            'disk' => $diskName,
            'size_bytes' => $bytes,
        ];
    }

    /**
     * Load and decrypt an invoice's data snapshot from storage.
     *
     * @return array Decrypted snapshot array
     *
     * @throws \RuntimeException if the file is missing or decryption fails
     */
    public function loadData(Invoice $invoice): array
    {
        if (!$invoice->data_path || !$invoice->data_disk) {
            throw new \RuntimeException("Invoice {$invoice->uuid} has no stored data snapshot.");
        }

        $disk = $this->buildDiskForInvoice($invoice);

        if (!$disk->exists($invoice->data_path)) {
            throw new \RuntimeException("Data snapshot file not found for invoice {$invoice->uuid}.");
        }

        $encrypted = $disk->get($invoice->data_path);

        try {
            return $this->encryption->decryptToArray($encrypted);
        } catch (\Throwable $e) {
            throw new \RuntimeException("Failed to decrypt invoice snapshot for {$invoice->uuid}: " . $e->getMessage(), previous: $e);
        }
    }

    /**
     * Delete the stored data snapshot for an invoice and update R2 usage tracking.
     */
    public function delete(Invoice $invoice): void
    {
        if (!$invoice->data_path || !$invoice->data_disk) {
            return;
        }

        try {
            $disk = $this->buildDiskForInvoice($invoice);

            if ($disk->exists($invoice->data_path)) {
                $disk->delete($invoice->data_path);
            }

            if ($invoice->data_disk === 'r2' && $invoice->data_size_bytes) {
                $this->settingsService->decrementR2Usage($invoice->data_size_bytes);
            }
        } catch (\Throwable $e) {
            Log::warning("InvoiceStorageService: Failed to delete snapshot for invoice {$invoice->uuid}: " . $e->getMessage());
        }
    }

    /**
     * Build a Filesystem instance from the current invoice_settings storage config.
     * Uses Storage::build() to read credentials from the database, not env vars.
     *
     * @throws \RuntimeException if required config fields are missing
     */
    public function buildDisk(InvoiceSettings $settings): Filesystem
    {
        $driver = $settings->storage_driver;

        if ($driver === 'local') {
            return Storage::disk('local');
        }

        // storage_config is auto-decrypted by the EncryptedJson cast on InvoiceSettings
        $config = $settings->storage_config ?? [];

        $required = $driver === 'r2'
            ? ['key', 'secret', 'bucket']
            : ['key', 'secret', 'region', 'bucket'];

        $missing = array_filter($required, fn ($k) => empty($config[$k]));
        if (!empty($missing)) {
            throw new \RuntimeException("Invoice storage is set to '{$driver}' but the following required config fields are missing: " . implode(', ', $missing) . '. Configure them in Admin → Billing → Invoice Settings → Storage.');
        }

        $diskConfig = [
            'driver' => 's3',
            'key' => $config['key'],
            'secret' => $config['secret'],
            'bucket' => $config['bucket'],
            'region' => $driver === 'r2' ? 'auto' : ($config['region'] ?? 'us-east-1'),
            'use_path_style_endpoint' => false,
            'throw' => true,
        ];

        if ($driver === 'r2') {
            $accountId = $config['account_id'] ?? null;
            $diskConfig['endpoint'] = !empty($config['endpoint'])
                ? $config['endpoint']
                : ($accountId ? "https://{$accountId}.r2.cloudflarestorage.com" : null);

            if (empty($diskConfig['endpoint'])) {
                throw new \RuntimeException('R2 endpoint cannot be determined. Provide an Account ID or a custom Endpoint URL in Invoice Settings.');
            }

            $diskConfig['options'] = ['ChecksumAlgorithm' => null];
        }

        return Storage::build($diskConfig);
    }

    /**
     * Build a disk for an already-stored invoice.
     * Falls back to a named disk if the invoice was stored under a previously-configured driver.
     */
    private function buildDiskForInvoice(Invoice $invoice): Filesystem
    {
        $settings = $this->settingsService->get();

        if ($invoice->data_disk === $settings->storage_driver) {
            return $this->buildDisk($settings);
        }

        if ($invoice->data_disk === 'local') {
            return Storage::disk('local');
        }

        // Best-effort fallback for invoices stored under a now-removed driver config
        return Storage::disk($invoice->data_disk);
    }

    /**
     * Enforce the configured R2 hard limit before writing a new file.
     *
     * @throws \RuntimeException
     */
    private function enforceR2Limit(InvoiceSettings $settings, int $additionalBytes): void
    {
        $projected = $settings->r2_bytes_used + $additionalBytes;
        if ($projected >= $settings->r2_bytes_limit) {
            $usedMb = round($settings->r2_bytes_used / 1024 / 1024, 1);
            $limitMb = round($settings->r2_bytes_limit / 1024 / 1024, 1);
            throw new \RuntimeException("Invoice storage blocked: R2 usage ({$usedMb} MB) would exceed the hard limit ({$limitMb} MB). " . 'Clear old invoice data or increase the limit in Invoice Settings.');
        }
    }
}
