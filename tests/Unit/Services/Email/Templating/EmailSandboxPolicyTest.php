<?php

namespace Everest\Tests\Unit\Services\Email\Templating;

use Everest\Tests\TestCase;
use Twig\Sandbox\SecurityError;
use Twig\Error\Error as TwigError;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Services\Email\Templating\TwigEnvironmentFactory;

/**
 * The security proof for the Blade → Twig migration.
 *
 * Under Blade every one of these would have executed, because `{{ }}` compiled to
 * `<?= e(...) ?>` and any expression it contained ran as PHP. Each case below asserts that
 * the same intent now raises instead.
 */
class EmailSandboxPolicyTest extends TestCase
{
    private TwigEnvironmentFactory $factory;

    public function setUp(): void
    {
        parent::setUp();

        $this->factory = new TwigEnvironmentFactory();
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function blockedSourceProvider(): array
    {
        return [
            // Arbitrary code execution attempts.
            'php filter chain' => ['{{ "id"|shell_exec }}'],
            'template_from_string' => ['{{ include(template_from_string("{{ 7*7 }}")) }}'],
            'dynamic include function' => ['{{ include("/etc/passwd") }}'],
            'source function' => ['{{ source("/etc/passwd") }}'],
            'constant function' => ['{{ constant("PHP_VERSION") }}'],
            'dump function' => ['{{ dump() }}'],

            // Escaping the sandbox through the environment object.
            'self env access' => ['{{ _self.env.getFilter("map") }}'],
            'attribute function' => ['{{ attribute(_self, "env") }}'],

            // Reaching objects that happen to be in scope is covered by the dedicated
            // method/property tests below -- they need a real object with a real member,
            // since a miss on stdClass resolves to null without consulting the policy.

            // Disallowed tags.
            'sandbox tag' => ['{% sandbox %}{% include "layout.twig" %}{% endsandbox %}'],
            'use tag' => ['{% use "partials/button.twig" %}'],

            // Filters that are not on the allow-list.
            'raw filter' => ['{{ appName|raw }}'],
            'map filter' => ['{{ [1,2]|map(v => v)|join(",") }}'],
            'filter filter' => ['{{ [1,2]|filter(v => v > 1)|join(",") }}'],
            'reduce filter' => ['{{ [1,2]|reduce((c, v) => c + v) }}'],
        ];
    }

    #[DataProvider('blockedSourceProvider')]
    public function testDisallowedConstructsRaise(string $source): void
    {
        $twig = $this->factory->make('probe.twig', $source);

        $this->expectException(TwigError::class);

        $twig->render('probe.twig', ['appName' => 'Panel', 'subject' => new \stdClass()]);
    }

    /**
     * Templates are addressed by logical name through a loader rooted at the email
     * directory, so a traversal target does not resolve at all.
     */
    public function testTemplatesOutsideTheEmailDirectoryCannotBeLoaded(): void
    {
        $twig = $this->factory->make('probe.twig', '{% include "../../../.env" %}');

        $this->expectException(TwigError::class);

        $twig->render('probe.twig', []);
    }

    public function testMethodCallsOnContextObjectsRaiseSecurityError(): void
    {
        $twig = $this->factory->make('probe.twig', '{{ thing.format("Y") }}');

        $this->expectException(SecurityError::class);

        $twig->render('probe.twig', ['thing' => new \DateTimeImmutable()]);
    }

    public function testPropertyAccessOnContextObjectsRaisesSecurityError(): void
    {
        $object = new \stdClass();
        $object->secret = 'value';

        $twig = $this->factory->make('probe.twig', '{{ thing.secret }}');

        $this->expectException(SecurityError::class);

        $twig->render('probe.twig', ['thing' => $object]);
    }

    /**
     * The counterpart to the above: everything the shipped templates actually rely on has
     * to keep working, or the policy is too tight to be useful.
     */
    public function testAllowedConstructsStillRender(): void
    {
        $source = <<<'TWIG'
            {% set greeting = name|default('there')|upper %}
            {% if greeting is not empty %}{{ greeting }}{% endif %}
            {% for label, value in rows %}{{ label }}={{ value }};{% endfor %}
            {{ amount|number_format(2) }}
            {{ text|nl2br }}
            TWIG;

        $twig = $this->factory->make('probe.twig', $source);

        $html = $twig->render('probe.twig', [
            'name' => 'jane',
            'rows' => ['a' => 1, 'b' => 2],
            'amount' => 12.5,
            'text' => "one\ntwo",
        ]);

        $this->assertStringContainsString('JANE', $html);
        $this->assertStringContainsString('a=1;b=2;', $html);
        $this->assertStringContainsString('12.50', $html);
        $this->assertStringContainsString("one<br />\ntwo", $html);
    }

    /**
     * Autoescaping is on and is not incidental -- an operator template interpolating a
     * value must never emit markup.
     */
    public function testOutputIsAutoescaped(): void
    {
        $twig = $this->factory->make('probe.twig', '{{ value }}');

        $html = $twig->render('probe.twig', ['value' => '<script>alert(1)</script>']);

        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }

    public function testUnsafeViewNamesAreRejected(): void
    {
        $this->assertNull(TwigEnvironmentFactory::templateName('emails.../../secrets'));
        $this->assertNull(TwigEnvironmentFactory::templateName('emails./etc/passwd'));
        $this->assertNull(TwigEnvironmentFactory::templateName(''));
        $this->assertSame('auth/password-reset.twig', TwigEnvironmentFactory::templateName('emails.auth.password-reset'));
    }
}
