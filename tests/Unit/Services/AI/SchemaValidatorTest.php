<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Services\AI\Support\SchemaValidator;

class SchemaValidatorTest extends TestCase
{
    private SchemaValidator $validator;

    public function setUp(): void
    {
        parent::setUp();

        $this->validator = new SchemaValidator();
    }

    private function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'path' => ['type' => 'string'],
                'lines' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 500],
                'recursive' => ['type' => 'boolean'],
                'mode' => ['type' => 'string', 'enum' => ['read', 'write']],
                'files' => ['type' => 'array', 'items' => ['type' => 'string']],
            ],
            'required' => ['path'],
            'additionalProperties' => false,
        ];
    }

    public function testAcceptsAWellFormedCall(): void
    {
        $result = $this->validator->validate(
            ['path' => '/a.txt', 'lines' => 50, 'recursive' => true, 'mode' => 'read'],
            $this->schema()
        );

        $this->assertTrue($result['valid']);
        $this->assertSame([], $result['errors']);
    }

    public function testReportsMissingRequiredArgumentsByName(): void
    {
        $result = $this->validator->validate(['lines' => 5], $this->schema());

        $this->assertFalse($result['valid']);
        // The message is fed straight back to the model, so it has to name the field.
        $this->assertStringContainsString('path', $result['errors'][0]);
    }

    public function testCoercesNumericStringsToIntegers(): void
    {
        // Small local models routinely emit numbers as strings. That is a
        // formatting slip, not an intent error — correcting it avoids burning
        // a repair round on a call the model already got right.
        $result = $this->validator->validate(['path' => '/a', 'lines' => '50'], $this->schema());

        $this->assertTrue($result['valid']);
        $this->assertSame(50, $result['value']['lines']);
    }

    public function testCoercesStringBooleans(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'recursive' => 'true'], $this->schema());

        $this->assertTrue($result['valid']);
        $this->assertTrue($result['value']['recursive']);

        $result = $this->validator->validate(['path' => '/a', 'recursive' => 'no'], $this->schema());
        $this->assertTrue($result['valid']);
        $this->assertFalse($result['value']['recursive']);
    }

    public function testWrapsASingleValueWhereAListWasExpected(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'files' => 'one.txt'], $this->schema());

        $this->assertTrue($result['valid']);
        $this->assertSame(['one.txt'], $result['value']['files']);
    }

    public function testMatchesEnumMembersRegardlessOfCasing(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'mode' => 'READ'], $this->schema());

        $this->assertTrue($result['valid']);
        $this->assertSame('read', $result['value']['mode']);
    }

    public function testRejectsValuesOutsideAnEnum(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'mode' => 'delete'], $this->schema());

        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('read, write', $result['errors'][0]);
    }

    public function testEnforcesNumericBounds(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'lines' => 9000], $this->schema());

        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('500', $result['errors'][0]);
    }

    public function testRejectsNonIntegerWhereAWholeNumberIsRequired(): void
    {
        $result = $this->validator->validate(['path' => '/a', 'lines' => 2.5], $this->schema());

        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('whole number', $result['errors'][0]);
    }

    public function testDropsUnknownArgumentsRatherThanFailingTheCall(): void
    {
        // An invented extra field still leaves a usable call, and the executor
        // validates the real request separately.
        $result = $this->validator->validate(
            ['path' => '/a', 'colour' => 'blue'],
            $this->schema()
        );

        $this->assertTrue($result['valid']);
        $this->assertArrayNotHasKey('colour', $result['value']);
        $this->assertSame('/a', $result['value']['path']);
    }

    public function testValidatesNestedObjectsAndArrayItems(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'edits' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => ['line' => ['type' => 'integer']],
                        'required' => ['line'],
                    ],
                ],
            ],
        ];

        $result = $this->validator->validate(['edits' => [['line' => '3'], ['line' => 'abc']]], $schema);

        $this->assertFalse($result['valid']);
        $this->assertSame(3, $result['value']['edits'][0]['line']);
        $this->assertStringContainsString('edits[1].line', $result['errors'][0]);
    }
}
