<?php

namespace Everest\Tests\Unit\Services\Security;

use Everest\Tests\TestCase;
use Illuminate\Encryption\MissingAppKeyException;
use Everest\Services\Security\SecretEncryptionService;

class SecretEncryptionServiceTest extends TestCase
{
    public function testEncryptAndDecryptRoundTrip(): void
    {
        $service = new SecretEncryptionService();

        $encrypted = $service->encryptForStorage('super-secret');

        $this->assertNotSame('super-secret', $encrypted);
        $this->assertSame('super-secret', $service->decryptFromStorage($encrypted));
    }

    public function testDecryptsPlaintextValuesWithoutError(): void
    {
        $service = new SecretEncryptionService();

        $this->assertSame('plain-value', $service->decryptFromStorage('plain-value'));
    }

    public function testDecryptsWhenEncryptedMultipleTimes(): void
    {
        $service = new SecretEncryptionService();

        $once = $service->encryptForStorage('double-secret');
        $twice = $service->encryptForStorage($once);

        $this->assertSame('double-secret', $service->decryptFromStorage($twice));
    }

    public function testDetectsEmailApiKeyAsSecret(): void
    {
        $service = new SecretEncryptionService();

        $this->assertTrue($service->isSecretKey('modules:email:resend:api_key'));
    }

    public function testGracefullyHandlesMissingAppKeyOnDecrypt(): void
    {
        $service = new SecretEncryptionService();
        $originalKey = config('app.key');

        config()->set('app.key', null);

        $this->assertNull($service->decryptFromStorage('anything'));

        config()->set('app.key', $originalKey);
    }

    public function testEncryptThrowsWhenAppKeyMissing(): void
    {
        $this->expectException(MissingAppKeyException::class);

        $service = new SecretEncryptionService();
        $originalKey = config('app.key');

        config()->set('app.key', null);

        try {
            $service->encryptForStorage('value');
        } finally {
            config()->set('app.key', $originalKey);
        }
    }
}
