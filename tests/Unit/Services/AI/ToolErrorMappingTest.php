<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\ToolExecutor;

/**
 * What a failed tool call tells the model.
 *
 * This text is read twice — once by the model deciding what to do next, and
 * once by the user, who sees it on the tool row. Panel internals belong in
 * neither.
 */
class ToolErrorMappingTest extends TestCase
{
    private function map(int $status, array $first): array
    {
        $executor = new class (app(), app('db')) extends ToolExecutor {
            public function code(int $status, array $first): string
            {
                return $this->errorCode($status, $first);
            }

            public function detail(int $status, array $first): string
            {
                return $this->errorDetail($status, $first);
            }
        };

        return [$executor->code($status, $first), $executor->detail($status, $first)];
    }

    /**
     * The panel renders every exception with `class_basename($e)` as its code,
     * so passing one through put "DaemonConnectionException" in front of the
     * user on a missing directory.
     */
    public function testPhpClassNamesAreNotUsedAsErrorCodes(): void
    {
        [$code] = $this->map(404, ['code' => 'DaemonConnectionException', 'detail' => 'x']);

        $this->assertSame('not_found', $code);
    }

    public function testStableMachineCodesArePassedThrough(): void
    {
        [$code] = $this->map(422, ['code' => 'validation_failed', 'detail' => 'x']);

        $this->assertSame('validation_failed', $code);
    }

    public function testNodeFailuresAreDistinguishedFromPanelFailures(): void
    {
        [$code] = $this->map(504, []);

        $this->assertSame('node_unavailable', $code);
    }

    /**
     * The daemon wraps the node's own message in prose plus a request id. Both
     * are noise the model pays for on every later step of the turn.
     */
    public function testTheDaemonEnvelopeIsUnwrapped(): void
    {
        [, $detail] = $this->map(404, [
            'detail' => 'An error occurred on the remote host: the requested directory does not exist. (request id: <nil>)',
        ]);

        $this->assertSame('the requested directory does not exist', $detail);
    }

    public function testTrailingRequestIdNoiseIsStripped(): void
    {
        [, $detail] = $this->map(409, [
            'detail' => 'There was an error while communicating with the machine running this server. (code: 409) (request_id: abc123)',
        ]);

        $this->assertSame('There was an error while communicating with the machine running this server.', $detail);
    }

    /**
     * AI-030. A 5xx detail is never quoted, in any mode.
     *
     * With APP_DEBUG on it is the raw exception message; with it off, a
     * controller that wraps its own failure puts the same thing in the same
     * field. Neither is actionable to a model — a 5xx means wait and retry —
     * and both are echoed onto a user's screen over SSE.
     */
    public function testFiveHundredLevelDetailIsNeverQuoted(): void
    {
        $leaky = [
            'detail' => 'Failed to update a product: SQLSTATE[42S02]: Base table or view not found: '
                . "1146 Table 'panel.products' doesn't exist (Connection: mysql) at /var/www/panel/app/Foo.php",
            'code' => 'QueryException',
        ];

        foreach ([500, 502, 503, 504] as $status) {
            [$code, $detail] = $this->map($status, $leaky);

            foreach (['SQLSTATE', 'panel.products', '/var/www/panel', 'QueryException', 'mysql'] as $sentinel) {
                $this->assertStringNotContainsString($sentinel, $detail, 'status ' . $status);
            }

            $this->assertStringNotContainsString('QueryException', $code);
        }
    }

    /**
     * A 404 is the model's cue to look rather than guess again — which is the
     * behaviour that sent it hunting /logs, /crash-reports and /mods on a
     * server that had never been started.
     */
    public function testAMissingPathTellsTheModelToListTheParent(): void
    {
        [, $detail] = $this->map(404, []);

        $this->assertStringContainsString('parent directory', $detail);
    }

    public function testAnOrdinaryDetailIsLeftAlone(): void
    {
        [, $detail] = $this->map(422, ['detail' => 'The path field is required.']);

        $this->assertSame('The path field is required.', $detail);
    }
}
