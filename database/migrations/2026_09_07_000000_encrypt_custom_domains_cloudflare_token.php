<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Security\SecretEncryptionService;
use Everest\Services\CustomDomains\CloudflareCredentialService;

return new class () extends Migration {
    public function up(): void
    {
        DB::transaction(function () {
            $existing = DB::table('settings')->where('key', CloudflareCredentialService::KEY)->exists();
            if (!$existing) {
                $legacy = DB::table('settings')->where('key', CloudflareCredentialService::LEGACY_KEY)->value('value');
                $token = $legacy ?? env('CUSTOM_DOMAINS_CLOUDFLARE_TOKEN', '');
                if (!empty($token) && blank(config('app.key'))) {
                    throw new Illuminate\Encryption\MissingAppKeyException();
                }
                $secrets = app(SecretEncryptionService::class);
                $token = $secrets->decryptFromStorage($token);
                DB::table('settings')->insert([
                    'key' => CloudflareCredentialService::KEY,
                    'value' => $secrets->encryptForStorage($token) ?? '',
                ]);
            }

            DB::table('settings')->where('key', CloudflareCredentialService::LEGACY_KEY)->delete();
        });
    }

    public function down(): void
    {
        // Preserve the encrypted credential; rollback must never restore plaintext.
    }
};
