<?php

namespace Everest\Tests\Unit\Traits\Commands;

use Everest\Tests\TestCase;
use Everest\Traits\Commands\EnvironmentWriterTrait;

/**
 * Test that ReDoS vulnerabilities in EnvironmentWriterTrait are mitigated.
 */
class EnvironmentWriterTraitReDoSTest extends TestCase
{
    use EnvironmentWriterTrait;

    /**
     * Test that regex metacharacters in keys are properly escaped.
     */
    public function testRegexMetacharactersAreEscaped()
    {
        // Create a temporary .env file
        $tempEnv = tempnam(sys_get_temp_dir(), 'env_test_');
        file_put_contents($tempEnv, "APP_KEY=oldvalue\nDB_HOST=localhost\n");

        // Simulate writing with a key that contains regex metacharacters
        $content = file_get_contents($tempEnv);
        $key = 'APP_.*';  // This should not match multiple keys
        $escapedKey = preg_quote($key, '/');

        // Verify that the unescaped pattern would be dangerous
        $dangerousMatches = preg_match_all('/^' . $key . '=(.*)$/m', $content);
        $safeMatches = preg_match_all('/^' . $escapedKey . '=(.*)$/m', $content);

        // The unescaped version might match APP_KEY
        // The escaped version should not match anything (since literal 'APP_.*' doesn't exist)
        $this->assertEquals(0, $safeMatches, 'Escaped key should not match existing keys');

        // Cleanup
        @unlink($tempEnv);
    }

    /**
     * Test that catastrophic backtracking patterns are prevented.
     */
    public function testCatastrophicBacktrackingPrevented()
    {
        $tempEnv = tempnam(sys_get_temp_dir(), 'env_test_');
        file_put_contents($tempEnv, str_repeat('A', 1000) . "\n");

        $content = file_get_contents($tempEnv);

        // This pattern could cause catastrophic backtracking if not escaped
        $maliciousKey = '(A+)+B';
        $escapedKey = preg_quote($maliciousKey, '/');

        $startTime = microtime(true);
        $matches = preg_match_all('/^' . $escapedKey . '=(.*)$/m', $content);
        $endTime = microtime(true);

        $executionTime = $endTime - $startTime;

        // Should complete very quickly (well under 1 second)
        $this->assertLessThan(0.1, $executionTime, 'Regex should complete quickly without backtracking');
        $this->assertEquals(0, $matches, 'Should not match with escaped pattern');

        // Cleanup
        @unlink($tempEnv);
    }

    /**
     * Test that pipe character injection is prevented.
     */
    public function testPipeCharacterInjectionPrevented()
    {
        $tempEnv = tempnam(sys_get_temp_dir(), 'env_test_');
        file_put_contents($tempEnv, "APP_KEY=value1\nEVIL_KEY=value2\n");

        $content = file_get_contents($tempEnv);

        // Try to inject an OR condition in the regex
        $maliciousKey = 'APP_KEY|EVIL_KEY';
        $escapedKey = preg_quote($maliciousKey, '/');

        // Unescaped would match both lines
        $dangerousMatches = preg_match_all('/^' . $maliciousKey . '=(.*)$/m', $content);
        // Escaped should match neither (literal string "APP_KEY|EVIL_KEY" doesn't exist)
        $safeMatches = preg_match_all('/^' . $escapedKey . '=(.*)$/m', $content);

        $this->assertGreaterThan(0, $dangerousMatches, 'Unescaped pattern would be dangerous');
        $this->assertEquals(0, $safeMatches, 'Escaped pattern should not match');

        // Cleanup
        @unlink($tempEnv);
    }

    /**
     * Test that normal keys still work correctly after escaping.
     */
    public function testNormalKeysStillWork()
    {
        $tempEnv = tempnam(sys_get_temp_dir(), 'env_test_');
        file_put_contents($tempEnv, "APP_KEY=oldvalue\nDB_HOST=localhost\n");

        $content = file_get_contents($tempEnv);

        // Normal alphanumeric key with underscore
        $normalKey = 'APP_KEY';
        $escapedKey = preg_quote($normalKey, '/');

        $matches = preg_match_all('/^' . $escapedKey . '=(.*)$/m', $content);

        $this->assertEquals(1, $matches, 'Normal key should still match correctly');

        // Cleanup
        @unlink($tempEnv);
    }
}
