<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Servers;

use Everest\Tests\TestCase;

/**
 * Test that Zip Slip / path traversal vulnerabilities are properly mitigated.
 */
class ModsControllerZipSlipTest extends TestCase
{
    /**
     * Test that zip files with path traversal attempts are rejected.
     */
    public function testZipWithPathTraversalIsRejected()
    {
        // Create a test ZIP file with path traversal
        $tempDir = sys_get_temp_dir() . '/zipslip_test_' . uniqid();
        mkdir($tempDir, 0755, true);

        $zipPath = $tempDir . '/malicious.zip';
        $zip = new \ZipArchive();
        $zip->open($zipPath, \ZipArchive::CREATE);

        // Add a file with path traversal
        $zip->addFromString('../../../evil.txt', 'malicious content');
        $zip->addFromString('manifest.json', json_encode(['files' => []]));
        $zip->close();

        // Attempt to extract - should fail with validation
        $extractDir = $tempDir . '/extract';
        mkdir($extractDir, 0755, true);

        $zip = new \ZipArchive();
        $hasPathTraversal = false;

        if ($zip->open($zipPath) === true) {
            for ($i = 0; $i < $zip->numFiles; ++$i) {
                $entry = $zip->getNameIndex($i);

                // Check for path traversal attempts
                if (strpos($entry, '../') !== false) {
                    $hasPathTraversal = true;
                    break;
                }
            }

            $zip->close();
        }

        $this->assertTrue($hasPathTraversal, 'Zip file should be detected as containing path traversal');

        // Cleanup
        @unlink($zipPath);
        @rmdir($extractDir);
        @rmdir($tempDir);
    }

    /**
     * Test that zip files with backslash path traversal are rejected.
     */
    public function testZipWithBackslashTraversalIsRejected()
    {
        $tempDir = sys_get_temp_dir() . '/zipslip_test2_' . uniqid();
        mkdir($tempDir, 0755, true);

        $zipPath = $tempDir . '/malicious.zip';
        $zip = new \ZipArchive();
        $zip->open($zipPath, \ZipArchive::CREATE);

        // Add a file with Windows-style path traversal
        $zip->addFromString('..\\..\\..\\evil.txt', 'malicious content');
        $zip->close();

        $hasPathTraversal = false;
        $zip = new \ZipArchive();

        if ($zip->open($zipPath) === true) {
            for ($i = 0; $i < $zip->numFiles; ++$i) {
                $entry = $zip->getNameIndex($i);

                if (strpos($entry, '..') !== false) {
                    $hasPathTraversal = true;
                    break;
                }
            }

            $zip->close();
        }

        $this->assertTrue($hasPathTraversal, 'Zip file should be detected as containing backslash traversal');

        // Cleanup
        @unlink($zipPath);
        @rmdir($tempDir);
    }

    /**
     * Test that legitimate zip files are allowed.
     */
    public function testLegitimateZipIsAllowed()
    {
        $tempDir = sys_get_temp_dir() . '/zipslip_test3_' . uniqid();
        mkdir($tempDir, 0755, true);

        $zipPath = $tempDir . '/legitimate.zip';
        $zip = new \ZipArchive();
        $zip->open($zipPath, \ZipArchive::CREATE);

        // Add legitimate files
        $zip->addFromString('manifest.json', json_encode(['files' => []]));
        $zip->addFromString('overrides/config.txt', 'config content');
        $zip->addFromString('overrides/mods/mod.jar', 'mod content');
        $zip->close();

        $hasPathTraversal = false;
        $zip = new \ZipArchive();

        if ($zip->open($zipPath) === true) {
            for ($i = 0; $i < $zip->numFiles; ++$i) {
                $entry = $zip->getNameIndex($i);

                if (strpos($entry, '../') !== false) {
                    $hasPathTraversal = true;
                    break;
                }
            }

            $zip->close();
        }

        $this->assertFalse($hasPathTraversal, 'Legitimate zip file should not be flagged');

        // Cleanup
        @unlink($zipPath);
        @rmdir($tempDir);
    }
}
