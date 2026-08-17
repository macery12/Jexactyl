<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Privacy\RedactionMap;

/**
 * Keeping customer data out of the request.
 *
 * Two halves are worth guarding, and they pull against each other. The first is
 * that personal data is actually caught — an address in a user record, an
 * address a customer pasted into a ticket, a player's IP in a console line. The
 * second is that nothing *else* is caught, which on this panel is the harder
 * half: a four-part Minecraft version is a syntactically perfect IPv4 address
 * and a log timestamp is a syntactically perfect IPv6 one, so a careless
 * redactor would strip the two facts the assistant is most often asked about
 * while hiding nothing at all.
 */
class PiiRedactionTest extends TestCase
{
    private PiiRedactor $redactor;

    public function setUp(): void
    {
        parent::setUp();

        // Through forget() rather than a query: the settings repository caches
        // resolved keys on a *static*, so deleting the rows underneath it leaves
        // the previous test's value in place for the rest of the process.
        Setting::forget('settings::modules:ai:privacy:enabled');
        Setting::forget('settings::modules:ai:privacy:categories');

        $this->redactor = app(PiiRedactor::class);
    }

    /*
    |--------------------------------------------------------------------------
    | What gets caught
    |--------------------------------------------------------------------------
    */

    public function testRedactsEmailByFieldName(): void
    {
        $map = new RedactionMap();
        $out = $this->redactor->redact(['id' => 4, 'email' => 'jo@example.com'], $map);

        $this->assertSame(4, $out['id']);
        $this->assertMatchesRegularExpression('/^\[email_[0-9a-f]{6,}]$/', $out['email']);
        $this->assertSame(['jo@example.com'], array_values($map->all()));
    }

    public function testRedactsEmailInFreeText(): void
    {
        $map = new RedactionMap();
        $out = $this->redactor->redactText('Please reply to jo@example.com instead.', $map);

        $this->assertStringNotContainsString('jo@example.com', $out);
        $this->assertStringContainsString($map->tokenFor('email', 'jo@example.com'), $out);
    }

    public function testTheSameValueAlwaysGetsTheSameToken(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            ['email' => 'jo@example.com'],
            ['email' => 'sam@example.com'],
            ['email' => 'jo@example.com'],
        ], $map);

        // Correlation is the whole reason each value gets its own token: without
        // it the model cannot tell two customers apart and will merge them in
        // its answer.
        $this->assertSame($out[0]['email'], $out[2]['email']);
        $this->assertNotSame($out[0]['email'], $out[1]['email']);
    }

    public function testTheSameAddressGetsADifferentTokenInAnotherConversation(): void
    {
        // The tokens are what actually reach the inference provider. An unsalted
        // digest would hand it a stable pseudonym for this customer across every
        // conversation on the install — it would never learn who they are, but it
        // could tell that the same person keeps coming up.
        $first = new RedactionMap();
        $second = new RedactionMap();

        $this->assertNotSame(
            $first->tokenFor('email', 'jo@example.com'),
            $second->tokenFor('email', 'jo@example.com')
        );
    }

    public function testRedactsPlayerAddressesInConsoleOutput(): void
    {
        $map = new RedactionMap();
        $line = '[12:34:56 INFO]: Steve[/86.21.44.9:51234] logged in with entity id 42';

        $out = $this->redactor->redactText($line, $map);

        $this->assertStringNotContainsString('86.21.44.9', $out);
        $this->assertStringContainsString($map->tokenFor('ip', '86.21.44.9'), $out);
        // The port is not the address and is diagnostically useful.
        $this->assertStringContainsString(':51234', $out);
    }

    public function testRedactsCompressedIpv6Whole(): void
    {
        $map = new RedactionMap();

        // A pattern that only matches the tail of a compressed address leaks the
        // prefix it was meant to hide, which is worse than not matching at all.
        $out = $this->redactor->redactText('2001:db8::ff00:42:8329', $map);

        $this->assertSame($map->tokenFor('ip', '2001:db8::ff00:42:8329'), $out);
    }

    /**
     * AI-027. Every spelling of an address the grammar allows.
     *
     * The pattern that preceded this required a leading hex group, so
     * `::dead:beef` — a perfectly ordinary leading-compressed address — matched
     * nothing at all and went to the provider intact. Each of these is now
     * found by parsing the candidate rather than by trusting the shape of it.
     */
    public function testEveryValidAddressFormIsRedactedWhole(): void
    {
        foreach ([
            'leading-compressed' => '::dead:beef',
            'ipv4-mapped' => '::ffff:192.168.1.1',
            'zone id' => 'fe80::1%eth0',
            'full v6' => '2001:0db8:0000:0000:0000:ff00:0042:8329',
            'compressed v6' => '2001:db8::ff00:42:8329',
            'v4' => '203.0.113.9',
        ] as $label => $address) {
            $map = new RedactionMap();
            $out = $this->redactor->redactText('client ' . $address . ' connected', $map);

            $this->assertSame(
                'client ' . $map->tokenFor('ip', $address) . ' connected',
                $out,
                $label,
            );
            $this->assertSame([$address], array_values($map->all()), $label);
        }
    }

    /**
     * AI-027. An address at the end of a log line keeps its punctuation.
     *
     * The candidate is deliberately wider than the grammar, so it over-runs by
     * a character here; the parser gives the colon back rather than refusing
     * the whole match, which is what a stricter expression would have to do.
     */
    public function testAnAddressFollowedByPunctuationIsStillFound(): void
    {
        $map = new RedactionMap();
        $out = $this->redactor->redactText('2001:db8::1: connection refused', $map);

        $this->assertSame($map->tokenFor('ip', '2001:db8::1') . ': connection refused', $out);
    }

    /**
     * AI-027. What merely looks like an address, and is not.
     *
     * A MAC address is five colons and hex digits, which the old letter-based
     * heuristic read as an address; a timestamp is three groups of digits,
     * which it read as a version number by luck rather than by rule. Both are
     * now simply invalid addresses, which is what they are.
     */
    public function testAddressLookalikesAreLeftAlone(): void
    {
        $map = new RedactionMap();

        foreach ([
            'mac address' => 'link up on 00:1A:2B:3C:4D:5E now',
            'log timestamp' => '[12:34:56 INFO]: Done',
            'long timestamp' => 'took 01:02:03:04 to finish',
            'padded version' => 'build 0.14.2.3 loaded',
            'iso timestamp' => 'at 2026-08-17T09:41:12 the node replied',
            'port pair' => 'bound 25565:25565 ok',
        ] as $label => $text) {
            $this->assertSame($text, $this->redactor->redactText($text, $map), $label);
        }

        $this->assertTrue($map->isEmpty());
    }

    /**
     * AI-027. Every spelling of the panel's own plumbing is still exempt.
     */
    public function testPanelAddressesAreRecognisedInAnySpelling(): void
    {
        $map = new RedactionMap();

        foreach (['::1', '0:0:0:0:0:0:0:1', '127.0.0.1', '0.0.0.0', '::'] as $address) {
            $this->assertSame($address, $this->redactor->redactText($address, $map), $address);
        }

        $this->assertTrue($map->isEmpty());
    }

    public function testRedactsCardNumbersButNotOrderNumbers(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            'card' => '4111 1111 1111 1111',
            'reference' => '4111111111111112',
        ], $map);

        // Luhn is what separates the two: same shape, same length, one of them
        // an order id that the model needs.
        $this->assertMatchesRegularExpression('/^\[payment_[0-9a-f]{6,}]$/', $out['card']);
        $this->assertSame('4111111111111112', $out['reference']);
    }

    public function testRedactsRealNameFieldsButNotResourceNames(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            'first_name' => 'Jo',
            'lastName' => 'Bloggs',
            'name' => 'Survival SMP',
            'username' => 'jobloggs',
        ], $map);

        $this->assertMatchesRegularExpression('/^\[name_[0-9a-f]{6,}]$/', $out['first_name']);
        // Separator-insensitive: lastName, last_name and last-name are one field.
        $this->assertMatchesRegularExpression('/^\[name_[0-9a-f]{6,}]$/', $out['lastName']);
        $this->assertNotSame($out['first_name'], $out['lastName']);
        // The bare `name` key is a server, a product or a category far more often
        // than it is a person; matching it would empty the catalogue.
        $this->assertSame('Survival SMP', $out['name']);
        $this->assertSame('jobloggs', $out['username']);
    }

    public function testStructuredNameAndAddressFieldsAreMaskedAcrossCustomerControlledSources(): void
    {
        $map = new RedactionMap();
        $sources = [
            'ticket' => ['first_name' => 'Alice', 'address_1' => '12 High Street'],
            'file' => ['full_name' => 'Alice Smith', 'postal_code' => 'SW1A 1AA'],
            'console' => ['billing_name' => 'Alice Smith', 'city' => 'London'],
        ];

        $out = $this->redactor->redact($sources, $map);

        foreach ($out as $source) {
            foreach ($source as $value) {
                $this->assertMatchesRegularExpression('/^\[(?:name|address)_[0-9a-f]{6,}]$/', $value);
            }
        }
    }

    public function testNameAndAddressCategoriesDoNotPretendToDeidentifyFreeText(): void
    {
        Setting::set('settings::modules:ai:privacy:categories', json_encode(['name', 'address']));
        $redactor = app(PiiRedactor::class);

        $fixtures = [
            'ticket' => 'My name is Alice Smith; send it to 12 High Street, London.',
            'file' => 'owner: Alice Smith\npostal address: 12 High Street, London',
            'console' => '[INFO] Alice Smith connected from High Street',
            'server_name' => 'Alice Smith at 12 High Street',
            // Game prose is a key false-positive case for regex name/address
            // guesses and must remain operationally useful.
            'game_content' => 'Steve visited Highgarden and traded on LondonCraft SMP.',
        ];

        foreach ($fixtures as $source => $text) {
            $this->assertSame(
                $text,
                $redactor->redactText($text, new RedactionMap()),
                $source . ' must follow the documented structural-only limitation.'
            );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | What must not get caught
    |--------------------------------------------------------------------------
    */

    public function testLeavesFourPartVersionNumbersAlone(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            'version' => '1.20.4.1',
            'docker_image' => 'ghcr.io/pterodactyl/yolks:java_21',
            'startup_command' => 'java -jar paper-1.20.4.1.jar',
        ], $map);

        $this->assertSame('1.20.4.1', $out['version']);
        $this->assertSame('java -jar paper-1.20.4.1.jar', $out['startup_command']);
        $this->assertTrue($map->isEmpty());
    }

    /**
     * The version exemption buys an address through, and nothing else.
     *
     * It used to skip the free-text sweep outright, which is a much larger grant
     * than the collision it exists for needs. The match is on substrings — one
     * entry has to cover `startup_command`, `docker_image` and
     * `minecraft_version` alike — so "exempt from every pattern" reached a great
     * many fields, and a startup command is user-editable and routinely carries
     * a webhook URL or the operator's own address.
     */
    public function testTheVersionExemptionDoesNotAlsoLetPersonalDataThrough(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            'startup_command' => 'java -jar paper-1.20.4.1.jar --contact ops@example.com',
        ], $map);

        $this->assertStringContainsString(
            '1.20.4.1',
            $out['startup_command'],
            'The version is what the exemption is for and must survive it.'
        );
        $this->assertStringNotContainsString(
            'ops@example.com',
            $out['startup_command'],
            'An address in an exempted field is still an address.'
        );
    }

    public function testLeavesVersionSuffixesInFreeTextAlone(): void
    {
        $map = new RedactionMap();

        // Fenced by lookarounds rather than \b, so a run of digits that is part
        // of something longer is not a match.
        $this->assertSame(
            'paper-1.20.4.1-R0.1-SNAPSHOT.jar',
            $this->redactor->redactText('paper-1.20.4.1-R0.1-SNAPSHOT.jar', $map)
        );
    }

    public function testLeavesLogTimestampsAlone(): void
    {
        $map = new RedactionMap();

        // `12:34:56` matches the v6 shape exactly. Every console line the panel
        // handles starts with one, so getting this wrong would redact the whole
        // buffer.
        $this->assertSame(
            '[12:34:56 INFO]: Done (8.402s)',
            $this->redactor->redactText('[12:34:56 INFO]: Done (8.402s)', $map)
        );
    }

    public function testLeavesLoopbackAndResourceCountsAlone(): void
    {
        $map = new RedactionMap();

        $out = $this->redactor->redact([
            'bind' => '127.0.0.1',
            'memory_bytes' => 2147483648,
            'uptime_ms' => 123456789,
        ], $map);

        $this->assertSame('127.0.0.1', $out['bind']);
        $this->assertSame(2147483648, $out['memory_bytes']);
        $this->assertTrue($map->isEmpty());
    }

    public function testLeavesKeysAlone(): void
    {
        $map = new RedactionMap();
        $out = $this->redactor->redact(['email' => 'jo@example.com'], $map);

        // The model builds its next arguments out of these key names; a
        // tokenised key would break every follow-up call.
        $this->assertArrayHasKey('email', $out);
    }

    /*
    |--------------------------------------------------------------------------
    | AI-027 — the system prompt is a payload too
    |--------------------------------------------------------------------------
    */

    /**
     * A customer names their own server, and the panel interpolates that name
     * straight into the system prompt. It used to go unfiltered, so the exact
     * string that was tokenised on its way through `admin_server_view` reached
     * the provider verbatim two lines above it.
     */
    public function testCustomerControlledPromptFactsAreFilteredBeforeConcatenation(): void
    {
        $server = new \Everest\Models\Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'jo@example.com';
        $server->setRelation('egg', null);

        $user = User::factory()->make(['id' => 3, 'username' => 'customer']);
        $context = new AgentContext($user, $server, 'turn-prompt-facts');

        $prompt = app(\Everest\Services\AI\Agent\SystemPromptBuilder::class)->build($context);

        $this->assertStringNotContainsString('jo@example.com', $prompt);
        $this->assertStringContainsString(
            $context->redactions->tokenFor('email', 'jo@example.com'),
            $prompt,
        );
    }

    /**
     * The same value has to read as the same token wherever it appears, or the
     * model is looking at two customers where there is one.
     */
    public function testAPromptFactAndAToolResultShareOneToken(): void
    {
        $server = new \Everest\Models\Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'jo@example.com';
        $server->setRelation('egg', null);

        $context = new AgentContext(User::factory()->make(['id' => 3]), $server, 'turn-prompt-token');
        app(\Everest\Services\AI\Agent\SystemPromptBuilder::class)->build($context);

        $shaped = $this->redactor->redact(['email' => 'jo@example.com'], $context->redactions);

        $this->assertSame($context->redactions->tokenFor('email', 'jo@example.com'), $shaped['email']);
        $this->assertCount(1, $context->redactions->all());
    }

    /**
     * An ordinary server name is not personal data, and tokenising it would
     * cost the assistant the one noun the whole conversation is about.
     */
    public function testAnOrdinaryServerNameIsLeftInThePrompt(): void
    {
        $server = new \Everest\Models\Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';
        $server->setRelation('egg', null);

        $context = new AgentContext(User::factory()->make(['id' => 3]), $server, 'turn-prompt-plain');

        $this->assertStringContainsString(
            'Survival SMP',
            app(\Everest\Services\AI\Agent\SystemPromptBuilder::class)->build($context),
        );
        $this->assertTrue($context->redactions->isEmpty());
    }

    /*
    |--------------------------------------------------------------------------
    | Operator control
    |--------------------------------------------------------------------------
    */

    public function testDisablingRedactionPassesEverythingThrough(): void
    {
        Setting::set('settings::modules:ai:privacy:enabled', '0');

        $map = new RedactionMap();
        $out = app(PiiRedactor::class)->redact(['email' => 'jo@example.com'], $map);

        $this->assertSame('jo@example.com', $out['email']);
        $this->assertTrue($map->isEmpty());
    }

    public function testSecretsAreOffByDefaultAndOnWhenSelected(): void
    {
        $map = new RedactionMap();
        $token = 'sk-abcdefghijklmnopqrstuvwx';

        // Off by default because token-shaped strings collide with backup uuids
        // and file hashes the agent legitimately needs.
        $this->assertSame($token, $this->redactor->redactText($token, $map));

        Setting::set('settings::modules:ai:privacy:categories', json_encode(['secret']));

        $this->assertMatchesRegularExpression(
            '/^\[secret_[0-9a-f]{6,}]$/',
            app(PiiRedactor::class)->redactText($token, new RedactionMap())
        );
    }

    public function testUnknownCategoriesCannotReachTheWalker(): void
    {
        Setting::set('settings::modules:ai:privacy:categories', json_encode(['email', 'not_a_category']));

        $this->assertSame(['email'], app(PiiRedactor::class)->activeKinds());
    }

    public function testAnUnsetCategoryListMeansTheDefaultsNotNone(): void
    {
        // An operator who has never opened the privacy panel should still be
        // protected — an empty setting is "not configured", not "nothing".
        $this->assertContains('email', $this->redactor->activeKinds());
        $this->assertNotContains('secret', $this->redactor->activeKinds());
    }

    /*
    |--------------------------------------------------------------------------
    | The map
    |--------------------------------------------------------------------------
    */

    public function testRestorePutsTheRealValuesBack(): void
    {
        $map = new RedactionMap();
        $redacted = $this->redactor->redactText('I emailed jo@example.com about it.', $map);

        $this->assertSame(
            'I emailed jo@example.com about it.',
            $this->redactor->restore($redacted, $map)
        );
    }

    /**
     * The browser puts the real values back at render time, and it finds the
     * tokens with a regex of its own — `restoreRedactions()` in
     * `frontend/src/state/agentChat.ts`. There is no shared definition and no
     * typecheck across the seam, so a change to the minting shape here shows up
     * as an administrator reading `[email_3f9c1a]` where an address should be,
     * with nothing failing anywhere. This is that seam, asserted from the side
     * that decides it.
     */
    public function testEveryMintedTokenMatchesThePatternTheBrowserLooksFor(): void
    {
        $map = new RedactionMap();
        $pattern = '/^\[[a-z]+_[0-9a-f]+]$/';

        foreach (['jo@example.com', '203.0.113.9', '4111 1111 1111 1111', '+44 7700 900123'] as $i => $value) {
            $token = $map->tokenFor(['email', 'ip', 'payment', 'phone'][$i], $value);

            $this->assertMatchesRegularExpression($pattern, $token);
        }

        // Deliberately outside it: the overflow token stands for no single value
        // and is never recorded, so there is nothing for the browser to put back
        // and leaving it on screen is the honest outcome.
        for ($i = 0; $i < RedactionMap::MAX_ENTRIES; ++$i) {
            $map->tokenFor('email', "user{$i}@example.com");
        }

        $this->assertDoesNotMatchRegularExpression($pattern, $map->tokenFor('email', 'overflow@example.com'));
    }

    public function testTheMapIsBoundedAndStopsCorrelatingRatherThanGrowing(): void
    {
        $map = new RedactionMap();

        for ($i = 0; $i < RedactionMap::MAX_ENTRIES + 20; ++$i) {
            $map->tokenFor('email', "user{$i}@example.com");
        }

        $this->assertCount(RedactionMap::MAX_ENTRIES, $map->all());
        // Past the cap everything collapses onto one uncorrelated token — still
        // redacted, and unable to grow the stored column without bound.
        $this->assertSame('[email]', $map->tokenFor('email', 'someone-else@example.com'));
    }

    public function testTheMapSurvivesTheSuspensionRoundTrip(): void
    {
        $user = User::factory()->make(['id' => 1]);

        $context = new AgentContext($user, null, 'turn-1');
        $this->redactor->redact(['email' => 'jo@example.com'], $context->redactions);

        // An approval can sit unanswered for minutes; the token on screen has to
        // still resolve when the turn picks up again.
        $restored = AgentContext::fromState($user, null, 'turn-1', null, $context->toState());

        $this->assertSame($context->redactions->all(), $restored->redactions->all());
        // The salt travels too, or the same address would be given a second,
        // different token the moment the turn picked up again.
        $this->assertSame(
            $context->redactions->tokenFor('email', 'jo@example.com'),
            $restored->redactions->tokenFor('email', 'jo@example.com')
        );
    }

    public function testMergeNeverPutsTwoPeopleBehindOneToken(): void
    {
        // The reason tokens are derived from the value rather than counted. Two
        // maps built independently both used to start at one, so merging them
        // resolved a single token to two different addresses — and the panel
        // would then show the wrong person beside the right sentence.
        $stored = new RedactionMap();
        $stored->tokenFor('email', 'jo@example.com');

        $fresh = new RedactionMap();
        $fresh->tokenFor('email', 'sam@example.com');

        $stored->merge($fresh);

        $this->assertCount(2, $stored->all());
        $this->assertContains('jo@example.com', $stored->all());
        $this->assertContains('sam@example.com', $stored->all());
    }

    public function testMergeIsIdempotentForTheSameSaltedMap(): void
    {
        $map = new RedactionMap();
        $map->tokenFor('email', 'jo@example.com');

        $copy = RedactionMap::fromArray($map->toArray());
        $copy->tokenFor('email', 'sam@example.com');

        $map->merge($copy);

        // Same salt, so the shared value derives the same token in both and
        // there is nothing to reconcile.
        $this->assertCount(2, $map->all());
    }

    /**
     * AI-039. A token that means two different things in two maps.
     *
     * Tokens are twenty-four bits, and two independently-salted maps of a
     * couple of hundred entries each collide with probability in the fractions
     * of a percent — over an install's lifetime, not never. Skipping a token
     * already present resolved that by discarding the incoming value and
     * leaving its token pointing at somebody else's data, which is precisely
     * what the scheme exists to prevent.
     *
     * Constructed by hand rather than mined, because the point is the
     * resolution and not the arithmetic.
     */
    public function testAGenuineTokenCollisionKeepsBothValues(): void
    {
        $stored = RedactionMap::fromArray([
            'salt' => 'salt-of-the-stored-conversation',
            'values' => ['[email_abc123]' => 'jo@example.com'],
        ]);
        $incoming = RedactionMap::fromArray([
            'salt' => 'a-different-salt-entirely',
            'values' => ['[email_abc123]' => 'sam@example.com', '[ip_def456]' => '203.0.113.9'],
        ]);

        $stored->merge($incoming);
        $all = $stored->all();

        // The token that was already here keeps its meaning: a stored
        // transcript already refers to it.
        $this->assertSame('jo@example.com', $all['[email_abc123]']);

        // And the incoming value survives under a name of its own rather than
        // being dropped.
        $this->assertContains('sam@example.com', $all);
        $this->assertSame('203.0.113.9', $all['[ip_def456]']);
        $this->assertCount(3, $all);

        $reminted = array_search('sam@example.com', $all, true);
        $this->assertNotSame('[email_abc123]', $reminted);
        $this->assertMatchesRegularExpression('/^\[email_[0-9a-f]+]$/', $reminted);

        // Deterministic: the same merge lands the same way every time, so a
        // reload does not rename anybody.
        $again = RedactionMap::fromArray([
            'salt' => 'salt-of-the-stored-conversation',
            'values' => ['[email_abc123]' => 'jo@example.com'],
        ]);
        $again->merge($incoming);
        $this->assertSame($all, $again->all());

        // Repeating the merge changes nothing further.
        $stored->merge($incoming);
        $this->assertCount(3, $stored->all());
    }

    /**
     * AI-039. A conversation settles on one salt.
     *
     * An empty stored map used to mint a fresh salt on every load, so a
     * conversation ended up holding tokens derived under two different salts —
     * and which one a value got depended on the turn that happened to see it
     * first.
     */
    public function testAnUnsaltedConversationAdoptsTheSaltOfItsFirstTurn(): void
    {
        $turn = new RedactionMap();
        $turn->tokenFor('email', 'jo@example.com');

        $conversation = RedactionMap::fromArray(null);
        $conversation->merge($turn);

        $this->assertSame($turn->salt(), $conversation->salt());

        // So a value first seen on the next turn derives the same token it
        // would have on this one.
        $this->assertSame(
            $turn->tokenFor('email', 'sam@example.com'),
            $conversation->tokenFor('email', 'sam@example.com'),
        );

        // A salt that was actually stored is never displaced.
        $locked = RedactionMap::fromArray(['salt' => 'stored-salt', 'values' => []]);
        $locked->merge($turn);
        $this->assertSame('stored-salt', $locked->salt());
    }

    /**
     * AI-039. The overflow token stands for many values and restores to none.
     */
    public function testOverflowCollapsesToATokenTheBrowserWillNotRestore(): void
    {
        $map = new RedactionMap();

        for ($i = 0; $i < RedactionMap::MAX_ENTRIES; ++$i) {
            $map->tokenFor('email', "user{$i}@example.com");
        }

        $first = $map->tokenFor('email', 'overflow-one@example.com');
        $second = $map->tokenFor('email', 'overflow-two@example.com');

        $this->assertSame(RedactionMap::overflowToken('email'), $first);
        $this->assertSame($first, $second, 'Past the cap a kind collapses onto one token.');
        $this->assertCount(RedactionMap::MAX_ENTRIES, $map->all());
        $this->assertNotContains('overflow-one@example.com', $map->all());

        // No underscore, so it does not match the pattern the browser restores
        // with — there is nothing behind it, and showing one of the several
        // values it stands for would imply they were the same person.
        $this->assertDoesNotMatchRegularExpression('/^\[[a-z]+_[0-9a-f]+]$/', $first);
        $this->assertSame($first, $this->redactor->restore($first, $map));

        // And an overflowing map still merges without inventing an entry for it.
        $other = new RedactionMap();
        $other->tokenFor('email', 'late@example.com');
        $map->merge($other);
        $this->assertNotContains('overflow-one@example.com', $map->all());
    }

    public function testMalformedStoredMapsAreDiscarded(): void
    {
        $map = RedactionMap::fromArray([
            'salt' => 'abc',
            'values' => ['[email_aaa111]' => 'jo@example.com', 5 => 'x', '[ip_bbb222]' => ['nope']],
        ]);

        $this->assertSame(['[email_aaa111]' => 'jo@example.com'], $map->all());
    }

    public function testTheSaltIsNotHandedToTheBrowser(): void
    {
        $map = new RedactionMap();
        $map->tokenFor('email', 'jo@example.com');

        // `all()` is what the transcript endpoints send; `toArray()` is what the
        // column stores. Only the latter carries the salt.
        $this->assertArrayNotHasKey('salt', $map->all());
        $this->assertArrayHasKey('salt', $map->toArray());
    }

    public function testNewTokensAreDrainedOnceAndOnce(): void
    {
        $map = new RedactionMap();
        $token = $map->tokenFor('email', 'jo@example.com');

        // The wire carries a delta, not the whole map, so a twelve-step turn
        // does not resend everything on every result.
        $this->assertSame([$token => 'jo@example.com'], $map->drainFresh());
        $this->assertSame([], $map->drainFresh());
    }
}
