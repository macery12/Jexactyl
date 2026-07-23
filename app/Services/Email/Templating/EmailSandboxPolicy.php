<?php

namespace Everest\Services\Email\Templating;

use Twig\Sandbox\SecurityPolicy;
use Twig\Sandbox\SecurityPolicyInterface;

/**
 * The allow-list that email templates are rendered under.
 *
 * Everything is deny-by-default: a tag, filter, function or test not named below raises a
 * Twig SecurityError instead of executing. Methods and properties are allowed on nothing at
 * all, so even if an object leaks into the render context a template cannot call into it.
 *
 * This is what replaces Blade for email bodies. Blade compiles to PHP, so every construct
 * that takes an expression -- `{{ }}`, `@if`, `@include` -- was an arbitrary-code sink, and
 * a template an operator could edit was therefore a shell on the panel host. Twig evaluates
 * against its own restricted grammar and this policy narrows that grammar further.
 *
 * The policy is applied globally rather than through the `{% sandbox %}` tag, because that
 * tag only covers `{% include %}` -- a parent reached through `{% extends %}` is not
 * sandboxed, and the operator-editable body is always the child.
 */
final class EmailSandboxPolicy implements SecurityPolicyInterface
{
    /**
     * `extends`, `block` and `embed` carry template inheritance; the loader is what keeps
     * them inside the email directory. Deliberately absent: `use` (horizontal reuse, not
     * needed), and anything that would let a template reach the filesystem by name.
     */
    public const ALLOWED_TAGS = [
        'apply',
        'block',
        'embed',
        'extends',
        'for',
        'from',
        'if',
        'import',
        'include',
        'macro',
        'set',
        'verbatim',
        'with',
    ];

    /**
     * Presentation only. `raw` is deliberately excluded -- it would let an operator inject
     * unescaped HTML into an email body, and nothing shipped needs it. `nl2br` covers the
     * one place that did (admin broadcast), and it escapes before converting newlines.
     */
    public const ALLOWED_FILTERS = [
        'abs',
        'capitalize',
        'date',
        'default',
        'e',
        'escape',
        'first',
        'format',
        'join',
        'keys',
        'last',
        'length',
        'lower',
        'nl2br',
        'number_format',
        'replace',
        'round',
        'slice',
        'striptags',
        'title',
        'trim',
        'upper',
        'url_encode',
    ];

    /**
     * Deliberately absent, and the reason the sandbox is worth having: `include()`,
     * `source()` and `template_from_string()` (arbitrary template loading and evaluation),
     * `constant()` (reads any class constant), `attribute()` (dynamic property/method
     * access, which routes around the empty method allow-list) and `dump()`.
     */
    public const ALLOWED_FUNCTIONS = [
        'block',
        'cycle',
        'max',
        'min',
        'parent',
        'random',
        'range',
    ];

    public const ALLOWED_TESTS = [
        'defined',
        'empty',
        'even',
        'iterable',
        'null',
        'odd',
        'same as',
    ];

    private SecurityPolicy $policy;

    public function __construct()
    {
        $this->policy = new SecurityPolicy(
            allowedTags: self::ALLOWED_TAGS,
            allowedFilters: self::ALLOWED_FILTERS,
            // No methods and no properties on any class, at all. See the class docblock.
            allowedMethods: [],
            allowedProperties: [],
            allowedFunctions: self::ALLOWED_FUNCTIONS,
            allowedTests: self::ALLOWED_TESTS,
        );

        // Opt in to Twig 4.0 behaviour now: without this, `extends`, `use`, `parent`,
        // `block`, `attribute` and *every test* are implicitly allowed regardless of the
        // lists above. `attribute` in particular would defeat the empty method allow-list.
        $this->policy->setStrict(true);
    }

    /**
     * @param string[] $tags
     * @param string[] $filters
     * @param string[] $functions
     * @param string[] $tests
     *
     * @throws \Twig\Sandbox\SecurityError
     */
    public function checkSecurity($tags, $filters, $functions, array $tests = []): void
    {
        $this->policy->checkSecurity($tags, $filters, $functions, $tests);
    }

    /**
     * @param object $obj
     * @param string $method
     *
     * @throws \Twig\Sandbox\SecurityNotAllowedMethodError
     */
    public function checkMethodAllowed($obj, $method): void
    {
        $this->policy->checkMethodAllowed($obj, $method);
    }

    /**
     * @param object $obj
     * @param string $property
     *
     * @throws \Twig\Sandbox\SecurityNotAllowedPropertyError
     */
    public function checkPropertyAllowed($obj, $property): void
    {
        $this->policy->checkPropertyAllowed($obj, $property);
    }
}
