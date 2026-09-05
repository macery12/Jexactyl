/**
 * The browser half of the redaction seam, run against a PHP-generated fixture.
 *
 * The panel mints tokens in PHP and only the browser ever resolves them, so the
 * two implementations agree on a format that nothing type-checks across. The
 * guard for that used to be a PHP test asserting a PHP regex against PHP
 * output — which proves nothing about the browser, and would have passed
 * happily through a frontend-only regression.
 *
 * This runs the *real* `restoreRedactions` under Node (type stripping, no
 * bundler) over a fixture the real `PiiRedactor` produced. Reads a JSON
 * document on argv[2], writes the restored result to stdout for the PHP test to
 * compare. Deliberately no framework: adding a frontend test runner is a
 * separate decision, and this needs one import.
 */
import { restoreRedactions, restoreRedactionsDeep } from '../../frontend/src/lib/redaction.ts';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
    map: Record<string, string>;
    text: string;
    payload: unknown;
};

process.stdout.write(
    JSON.stringify({
        text: restoreRedactions(fixture.text, fixture.map),
        payload: restoreRedactionsDeep(fixture.payload, fixture.map),
    }),
);
