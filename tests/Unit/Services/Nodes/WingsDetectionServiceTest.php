<?php

namespace Everest\Tests\Unit\Services\Nodes;

use Everest\Models\Node;
use Everest\Tests\TestCase;

class WingsDetectionServiceTest extends TestCase
{
    /**
     * Test that a node with wings_type 'wings-rs' is detected as supercharged.
     */
    public function testNodeIsSupercharged()
    {
        $node = new Node();
        $node->wings_type = Node::WINGS_TYPE_RS;

        $this->assertTrue($node->isSupercharged());
    }

    /**
     * Test that a node with default wings_type is not supercharged.
     */
    public function testNodeIsNotSupercharged()
    {
        $node = new Node();
        $node->wings_type = Node::WINGS_TYPE_DEFAULT;

        $this->assertFalse($node->isSupercharged());
    }

    /**
     * Test that a new node defaults to the standard type.
     */
    public function testNewNodeDefaultsToStandard()
    {
        $node = new Node();

        $this->assertEquals(Node::WINGS_TYPE_DEFAULT, $node->wings_type);
        $this->assertFalse($node->isSupercharged());
    }

    /**
     * Test that the wings type constants are correctly defined.
     */
    public function testWingsTypeConstants()
    {
        $this->assertEquals('default', Node::WINGS_TYPE_DEFAULT);
        $this->assertEquals('wings-rs', Node::WINGS_TYPE_RS);
    }

    /**
     * Test the version detection pattern matching.
     */
    public function testVersionPatternDetection()
    {
        $service = new \Everest\Services\Nodes\WingsDetectionService(
            new \Everest\Repositories\Wings\DaemonConfigurationRepository(app())
        );

        // RS version strings
        $this->assertTrue($this->invokeMethod($service, 'isWingsRsVersion', ['1.0.0-rs']));
        $this->assertTrue($this->invokeMethod($service, 'isWingsRsVersion', ['wings-rs-1.0.0']));
        $this->assertTrue($this->invokeMethod($service, 'isWingsRsVersion', ['1.0.0-rust']));
        $this->assertTrue($this->invokeMethod($service, 'isWingsRsVersion', ['supercharged-1.0.0']));

        // Standard version strings
        $this->assertFalse($this->invokeMethod($service, 'isWingsRsVersion', ['1.11.0']));
        $this->assertFalse($this->invokeMethod($service, 'isWingsRsVersion', ['1.7.2']));
    }

    /**
     * Test that Node model has new fields in casts.
     */
    public function testNodeCastsIncludeNewFields()
    {
        $node = new Node();
        $casts = $node->getCasts();

        $this->assertArrayHasKey('wings_type', $casts);
        $this->assertArrayHasKey('wings_detected_at', $casts);
    }

    /**
     * Test that Node model has new fields in fillable.
     */
    public function testNodeFillableIncludesNewFields()
    {
        $node = new Node();
        $fillable = $node->getFillable();

        $this->assertContains('wings_type', $fillable);
        $this->assertContains('wings_version', $fillable);
        $this->assertContains('wings_detected_at', $fillable);
    }

    /**
     * Invoke a protected/private method for testing.
     */
    protected function invokeMethod($object, string $method, array $parameters = [])
    {
        $reflection = new \ReflectionClass(get_class($object));
        $method = $reflection->getMethod($method);
        $method->setAccessible(true);

        return $method->invokeArgs($object, $parameters);
    }
}
