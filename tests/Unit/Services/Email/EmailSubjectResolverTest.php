<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Services\Email\EmailSubjectResolver;

class EmailSubjectResolverTest extends TestCase
{
    public function testDeliverySubjectsPreserveExistingWording(): void
    {
        $this->assertSame('Welcome to Your Account', EmailSubjectResolver::forDelivery('auth.account_created'));
        $this->assertSame('Your Server Is Expiring Soon', EmailSubjectResolver::forDelivery('server.expiring_soon'));
        $this->assertSame('Notification', EmailSubjectResolver::forDelivery('unknown.template'));
    }

    public function testTrackingSubjectsPreserveExistingWording(): void
    {
        config(['app.name' => 'M12 Labs']);

        $this->assertSame('Welcome to M12 Labs', EmailSubjectResolver::forTracking('auth.account_created'));
        $this->assertSame('Server Suspended', EmailSubjectResolver::forTracking('server.suspended'));
        $this->assertSame('Notification from M12 Labs', EmailSubjectResolver::forTracking('unknown.template'));
    }
}
