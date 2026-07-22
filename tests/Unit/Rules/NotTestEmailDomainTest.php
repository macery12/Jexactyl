<?php

namespace Everest\Tests\Unit\Rules;

use Everest\Tests\TestCase;
use Everest\Rules\NotTestEmailDomain;

class NotTestEmailDomainTest extends TestCase
{
    public function testFailsForConfiguredTestDomains(): void
    {
        config(['email.domain_blacklist' => ['example.com', 'test.com', 'website.com']]);

        $rule = new NotTestEmailDomain();

        $this->assertFalse($rule->passes('email', 'user@example.com'));
        $this->assertFalse($rule->passes('email', 'user@TEST.com'));
        $this->assertFalse($rule->passes('email', 'user@website.com'));
    }

    public function testPassesForNonTestDomains(): void
    {
        config(['email.domain_blacklist' => ['example.com', 'test.com', 'website.com']]);

        $rule = new NotTestEmailDomain();

        $this->assertTrue($rule->passes('email', 'user@valid.com'));
        $this->assertTrue($rule->passes('email', 'user@sub.example.org'));
    }

    public function testHelperDetectsTestDomain(): void
    {
        config(['email.domain_blacklist' => ['example.com', 'test.com', 'website.com']]);

        $this->assertTrue(is_test_domain('name@example.com'));
        $this->assertTrue(is_test_domain('name@website.com'));
        $this->assertFalse(is_test_domain('name@domain.com'));
    }

    public function testMessage(): void
    {
        $this->assertSame('Enter a valid email address.', (new NotTestEmailDomain())->message());
    }
}
