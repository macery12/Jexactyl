<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Everest\Services\Queue\FailedJobRedactor;

/**
 * The queue page shows an operator why a job failed, and a failure carries its
 * secrets in two places. The payload is the obvious one. The exception is the
 * one that catches people out: Laravel interpolates a query's bindings into the
 * QueryException message, so a failed write stores its column values verbatim.
 *
 * These cover the pass that always runs -- the AI module's privacy setting is
 * switched off throughout, because an admin page must not become more revealing
 * because somebody changed a setting in a different module.
 */
class FailedJobRedactorTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        config(['modules.ai.privacy.enabled' => false]);
    }

    private function redactor(): FailedJobRedactor
    {
        return $this->app->make(FailedJobRedactor::class);
    }

    public function testCredentialKeysAreMaskedInAPayload(): void
    {
        $out = $this->redactor()->redact([
            'displayName' => 'Everest\\Jobs\\Email\\SendEmailJob',
            'data' => ['commandName' => 'SendEmailJob', 'api_key' => 'sk-live-abcdef', 'to' => 'ops@example.test'],
        ]);

        $this->assertSame('[redacted]', $out['data']['api_key']);
        $this->assertSame('ops@example.test', $out['data']['to'], 'Masking is for credentials, not for everything.');
    }

    /**
     * The serialised command is where model attributes -- and therefore the
     * bulk of the personal data -- actually live, and it is not something an
     * operator reads anyway.
     */
    public function testTheSerialisedCommandIsReportedRatherThanPrinted(): void
    {
        $out = $this->redactor()->redact([
            'data' => ['commandName' => 'Everest\\Jobs\\Email\\SendEmailJob', 'command' => str_repeat('O:24:"payload";', 40)],
        ]);

        $this->assertStringContainsString('not shown', $out['data']['command']);
        $this->assertStringNotContainsString('O:24:', $out['data']['command']);
    }

    /**
     * The reason this class exists at all. With bindings masked at the source
     * this is belt and braces, but a trace stored before that change -- or one
     * from a connection configured elsewhere -- still has to come out clean.
     */
    public function testQueryBindingsInAnExceptionMessageAreMasked(): void
    {
        $text = $this->redactor()->redactText(
            'SQLSTATE[23000]: (Connection: mysql, SQL: insert into "users" ("email", "password") '
            . 'values (a@b.test, $2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234))'
        );

        $this->assertStringNotContainsString('$2y$10$abcdefghij', $text);
        $this->assertStringContainsString('[redacted]', $text);
    }

    public function testNamedCredentialsAreMaskedWhereverTheyAppearInText(): void
    {
        $cases = [
            'mysql://panel:sup3rSecret@127.0.0.1:3306/panel' => 'sup3rSecret',
            'GET https://wings.test/api/servers?api_key=sk-live-abcdef123456 failed' => 'sk-live-abcdef123456',
            'Client error: {"error":"denied","client_secret":"cs_live_9f8a7b"}' => 'cs_live_9f8a7b',
            "array (  'password' => 'hunter2',)" => 'hunter2',
            'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.body.signature' => 'eyJhbGciOiJIUzI1NiJ9.body.signature',
        ];

        foreach ($cases as $input => $secret) {
            $out = $this->redactor()->redactText($input);

            $this->assertStringNotContainsString($secret, $out, "Leaked from: $input");
            $this->assertStringContainsString('[redacted]', $out, "Nothing masked in: $input");
        }
    }

    /**
     * This page exists to make errors readable. A scrub that blanks the
     * diagnosis has cost more than it saved, so every pattern requires a value
     * to be named or self-identifying before it fires.
     */
    public function testAnOrdinaryDiagnosisIsLeftAlone(): void
    {
        $cases = [
            'RuntimeException: SMTP connection refused',
            'SQLSTATE[23000]: Integrity constraint violation: foreign key constraint fails',
            'The token has expired and cannot be refreshed.',
            'Undefined array key "password"',
            'No query results for model [Everest\\Models\\Server] 42',
        ];

        foreach ($cases as $case) {
            $this->assertSame($case, $this->redactor()->redactText($case));
        }
    }

    public function testAnAlreadyMaskedValueIsNotMaskedTwice(): void
    {
        $this->assertSame(
            'Authorization: Bearer [redacted]',
            $this->redactor()->redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.body.signature'),
        );
    }

    /**
     * The other half of the same guarantee, and the one that actually matters
     * for anything written from here on: bindings are masked where the message
     * is built, so they never reach the log or the `failed_jobs` row in the
     * first place. This asserts the config wiring -- the key is read per
     * connection, so getting its name or its placement wrong fails silently.
     */
    public function testQueryBindingsAreMaskedWhereTheExceptionIsBuilt(): void
    {
        $this->expectException(QueryException::class);

        try {
            DB::table('a_table_that_does_not_exist')->where('col', 'sup3rSecretValue')->get();
        } catch (QueryException $e) {
            $this->assertStringNotContainsString('sup3rSecretValue', $e->getMessage());
            $this->assertStringContainsString('?', $e->getMessage(), 'The statement itself must still be reported.');

            throw $e;
        }
    }
}
