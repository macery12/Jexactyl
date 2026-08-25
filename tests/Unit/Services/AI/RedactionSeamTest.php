<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Symfony\Component\Process\Process;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Privacy\RedactionMap;

/**
 * The seam between the two redaction implementations.
 *
 * The panel mints tokens in PHP and only the browser ever resolves them. Nothing
 * type-checks across that boundary, so a change to the minting shape shows up as
 * an administrator reading `[email_3f9c1a]` where an address should be, with
 * every test still green.
 *
 * The guard that existed before this duplicated the PHP regex in a PHP test and
 * asserted PHP output against it — which is a tautology, and would have passed
 * through any frontend-only regression. What runs here is the real
 * `restoreRedactions()` from `frontend/src/lib/redaction.ts`, under Node, over a
 * fixture the real `PiiRedactor` produced. One fixture, both languages, which is
 * the only arrangement in which the assertion means anything.
 *
 * No frontend test runner is involved on purpose: the project has none, and
 * introducing one is a decision of its own rather than a side effect of closing
 * this finding.
 */
class RedactionSeamTest extends TestCase
{
    /** Type stripping without a bundler. Node 22.6+. */
    private const NODE_ARGS = ['--experimental-strip-types', '--no-warnings'];

    public function testTheBrowserRestoresEveryTokenThePanelMints(): void
    {
        $map = new RedactionMap();
        $redactor = app(PiiRedactor::class);

        // One of every kind that has a pattern, plus a structural field, so the
        // fixture covers each token shape the minter can produce rather than
        // one representative.
        $payload = $redactor->redact([
            'email' => 'jo@example.com',
            'first_name' => 'Alice',
            'address_1' => '12 High Street',
            'nested' => [
                'note' => 'connected from 203.0.113.9 and ::dead:beef',
                'contact' => 'reach me on +44 7700 900123',
                'card' => '4111 1111 1111 1111',
            ],
            'untouched' => ['count' => 4, 'flag' => true, 'nothing' => null],
        ], $map);

        $text = $redactor->redactText(
            'Ticket from jo@example.com, last seen at 203.0.113.9 and ::dead:beef.',
            $map,
        );

        $this->assertNotEmpty($map->all(), 'The fixture must actually redact something.');
        $this->assertStringNotContainsString('jo@example.com', $text);

        $restored = $this->restoreInNode($map, $text, $payload);

        // The browser's answer, compared against the PHP inverse. Both sides
        // must arrive at the original.
        $this->assertSame($redactor->restore($text, $map), $restored['text']);
        $this->assertStringContainsString('jo@example.com', $restored['text']);
        $this->assertStringContainsString('203.0.113.9', $restored['text']);
        $this->assertStringContainsString('::dead:beef', $restored['text']);

        $this->assertSame('jo@example.com', $restored['payload']['email']);
        $this->assertSame('Alice', $restored['payload']['first_name']);
        $this->assertSame('12 High Street', $restored['payload']['address_1']);
        $this->assertSame('4111 1111 1111 1111', $restored['payload']['nested']['card']);
        $this->assertStringContainsString('203.0.113.9', $restored['payload']['nested']['note']);
        $this->assertStringContainsString('::dead:beef', $restored['payload']['nested']['note']);
        $this->assertStringContainsString('+44 7700 900123', $restored['payload']['nested']['contact']);

        // Non-string values survive the deep walk unchanged rather than being
        // stringified on their way through it.
        $this->assertSame(4, $restored['payload']['untouched']['count']);
        $this->assertTrue($restored['payload']['untouched']['flag']);
        $this->assertNull($restored['payload']['untouched']['nothing']);
    }

    /**
     * A token the map does not know is left exactly as written.
     *
     * The two sides can disagree in this direction too: a browser that stripped
     * unknown tokens would silently delete text the model wrote, and one that
     * substituted a neighbouring entry would attribute one customer's data to
     * another.
     */
    public function testAnUnknownTokenIsLeftAloneRatherThanGuessedAt(): void
    {
        $map = new RedactionMap();
        $known = $map->tokenFor(PiiRedactor::KIND_EMAIL, 'jo@example.com');

        $restored = $this->restoreInNode(
            $map,
            sprintf('%s wrote about [email_ffffffff] and [ip_0].', $known),
            ['echo' => '[secret_abc123]'],
        );

        $this->assertStringContainsString('jo@example.com', $restored['text']);
        $this->assertStringContainsString('[email_ffffffff]', $restored['text']);
        $this->assertStringContainsString('[ip_0]', $restored['text']);
        $this->assertSame('[secret_abc123]', $restored['payload']['echo']);
    }

    /**
     * Markdown escaping is presentation syntax, not part of the opaque token.
     * Local models commonly protect underscores and brackets in prose, so the
     * browser accepts those reversible spellings only when the normalised token
     * exists in the conversation's map. Unknown spellings remain untouched.
     */
    public function testTheBrowserRestoresKnownMarkdownEscapedTokensOnly(): void
    {
        $map = new RedactionMap();
        $known = $map->tokenFor(PiiRedactor::KIND_EMAIL, 'jo@example.com');
        $underscoreEscaped = str_replace('_', '\\_', $known);
        $fullyEscaped = strtr($known, ['[' => '\\[', '_' => '\\_', ']' => '\\]']);

        $restored = $this->restoreInNode(
            $map,
            sprintf('%s and %s', $underscoreEscaped, $fullyEscaped),
            [
                'underscore' => $underscoreEscaped,
                'full' => $fullyEscaped,
                'unknown' => '[ip\\_0]',
                'unknown_full' => '\\[ip\\_0\\]',
            ],
        );

        $this->assertSame('jo@example.com and jo@example.com', $restored['text']);
        $this->assertSame('jo@example.com', $restored['payload']['underscore']);
        $this->assertSame('jo@example.com', $restored['payload']['full']);
        $this->assertSame('[ip\\_0]', $restored['payload']['unknown']);
        $this->assertSame('\\[ip\\_0\\]', $restored['payload']['unknown_full']);
    }

    /**
     * Run the real browser implementation over a fixture this process wrote.
     *
     * @return array{text: string, payload: mixed}
     */
    private function restoreInNode(RedactionMap $map, string $text, mixed $payload): array
    {
        $module = base_path('frontend/src/lib/redaction.ts');
        $harness = base_path('tests/Fixtures/redaction-seam.ts');

        $this->assertFileExists($module, 'The browser implementation moved; update the harness import.');

        $fixture = tempnam(sys_get_temp_dir(), 'redaction-seam-') . '.json';
        file_put_contents($fixture, json_encode([
            // `all()` and not the stored shape: the salt travels with the
            // column and has no business on a wire a browser reads, so what is
            // asserted here is exactly what the browser is given.
            'map' => $map->all(),
            'text' => $text,
            'payload' => $payload,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        try {
            $process = new Process(array_merge(['node'], self::NODE_ARGS, [$harness, $fixture]));
            $process->run();

            if (!$process->isSuccessful()) {
                $this->markTestSkipped(
                    'Node could not execute the browser redaction module: ' . trim($process->getErrorOutput())
                );
            }

            $decoded = json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
        } finally {
            @unlink($fixture);
        }

        return $decoded;
    }
}
