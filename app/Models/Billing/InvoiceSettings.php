<?php

namespace Everest\Models\Billing;

use Everest\Models\Model;
use Everest\Casts\EncryptedJson;

/**
 * Singleton settings row for invoice generation (id = 1 always).
 *
 * @property int $id
 * @property string $company_name
 * @property string $company_address
 * @property string $company_city
 * @property string $company_state
 * @property string $company_zip
 * @property string $company_country
 * @property string|null $company_logo_url
 * @property string|null $company_tax_id
 * @property string $invoice_prefix
 * @property int $invoice_sequence
 * @property string $storage_driver local|s3|r2
 * @property array|null $storage_config Encrypted at rest via EncryptedJson cast
 * @property int $r2_bytes_used
 * @property int $r2_bytes_limit
 * @property bool $auto_cleanup_enabled Whether to auto-delete invoice data after N years
 * @property int $auto_cleanup_after_years Years after which data is deleted (default 3)
 */
class InvoiceSettings extends Model
{
    protected $table = 'invoice_settings';

    protected $fillable = [
        'company_name',
        'company_address',
        'company_city',
        'company_state',
        'company_zip',
        'company_country',
        'company_logo_url',
        'company_tax_id',
        'invoice_prefix',
        'invoice_sequence',
        'storage_driver',
        'storage_config',
        'r2_bytes_used',
        'r2_bytes_limit',
        'auto_cleanup_enabled',
        'auto_cleanup_after_years',
        'require_billing_address',
    ];

    protected $casts = [
        'invoice_sequence' => 'int',
        'storage_config' => EncryptedJson::class,  // AES-256 encrypted at rest
        'r2_bytes_used' => 'int',
        'r2_bytes_limit' => 'int',
        'auto_cleanup_enabled' => 'bool',
        'auto_cleanup_after_years' => 'int',
        'require_billing_address' => 'bool',
    ];
}
