<?php

namespace Everest\Tests\Unit\Models;

use Everest\Tests\TestCase;
use Everest\Models\ExtensionRepository;

class ExtensionRepositoryRouteBindingTest extends TestCase
{
    public function testUsesPrimaryKeyForRouteBinding(): void
    {
        $repository = new ExtensionRepository();

        $this->assertSame('id', $repository->getRouteKeyName());
    }
}
