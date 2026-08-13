<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Route;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\Authorization\AdminCapabilityRegistry;

/**
 * The admin toolset's contract with the rest of the panel.
 *
 * Every one of these would otherwise fail at runtime, in front of a user, as a
 * confidently-worded tool call that 403s or 404s.
 */
class AdminToolsTest extends TestCase
{
    /**
     * A tool whose URI does not match a registered route is unreachable, and the
     * model has no way to find that out except by calling it.
     */
    public function testEveryAdminToolUriResolvesToARegisteredRoute(): void
    {
        $registered = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $registered[$this->normalise('/' . $route->uri())] = true;
        }

        foreach (AdminTools::all() as $definition) {
            $this->assertArrayHasKey(
                $this->normalise($definition->uriTemplate),
                $registered,
                sprintf('%s points at an unregistered route: %s', $definition->name, $definition->uriTemplate)
            );
        }
    }

    /**
     * A capability that is not in the registry fails closed for everybody,
     * including the owner — the tool would simply never be offered.
     */
    public function testEveryDeclaredCapabilityIsAssignable(): void
    {
        $valid = app(AdminCapabilityRegistry::class);

        foreach (AdminTools::all() as $definition) {
            foreach ($definition->permissions as $capability) {
                $this->assertTrue(
                    $valid->isValid($capability),
                    sprintf('%s declares "%s", which is not an assignable capability.', $definition->name, $capability)
                );
            }
        }
    }

    /**
     * v1 registers nothing destructive, so the typed-confirmation path is
     * unreachable on the admin surface. Adding a destructive tool without
     * building that path would let a delete through on a plain approval card.
     */
    public function testNoAdminToolIsDestructive(): void
    {
        foreach (AdminTools::all() as $definition) {
            $this->assertNotSame(
                ToolDefinition::RISK_DESTRUCTIVE,
                $definition->risk,
                $definition->name . ' is destructive, but the admin surface has no typed-confirmation path.'
            );
        }
    }

    /**
     * The registry indexes by bare name across every scope, and the operator's
     * risk overrides and disable list are keyed the same way. A collision would
     * shadow one tool and misconfigure both.
     */
    public function testToolNamesAreUniqueAcrossScopes(): void
    {
        $names = [];

        foreach ([ServerTools::all(), AdminTools::all(), SharedTools::all()] as $set) {
            foreach ($set as $definition) {
                $this->assertArrayNotHasKey($definition->name, $names, 'Duplicate tool name: ' . $definition->name);
                $names[$definition->name] = true;
            }
        }
    }

    /**
     * A listing without a shaper hands the model a full Fractal collection.
     * `GET /users` alone would consume most of the context window on the first
     * call, and the model would have no way to ask for less.
     */
    public function testEveryListingIsShaped(): void
    {
        foreach (AdminTools::all() as $definition) {
            if (!str_ends_with($definition->name, '_list')) {
                continue;
            }

            $this->assertIsCallable(
                $definition->resultShaper,
                $definition->name . ' returns a collection but declares no resultShaper.'
            );
        }
    }

    /**
     * Admin scope is what keeps these off the server surface, where the
     * authorization model is a subuser permission on a bound server rather than
     * an AdminRole capability.
     */
    public function testEveryAdminToolIsAdminScoped(): void
    {
        foreach (AdminTools::all() as $definition) {
            $this->assertSame(ToolDefinition::SCOPE_ADMIN, $definition->scope, $definition->name);
            $this->assertFalse($definition->inScope(ToolDefinition::SCOPE_SERVER), $definition->name);
        }
    }

    /**
     * A GET must not demand a mutating capability.
     *
     * Not merely tidy: the tool list is filtered by capability, so a read tool
     * requiring `billing.products-create` would be hidden from an administrator
     * who is perfectly entitled to look. Read capabilities are not all named
     * `*.read` — `billing.orders` is one — so the rule is stated as the absence
     * of a mutating verb rather than the presence of "read".
     */
    public function testReadToolsDoNotRequireMutatingCapabilities(): void
    {
        foreach (AdminTools::all() as $definition) {
            if (!$definition->isRead()) {
                continue;
            }

            foreach ($definition->permissions as $capability) {
                foreach (['create', 'update', 'delete', 'import', 'install'] as $verb) {
                    $this->assertStringNotContainsString(
                        $verb,
                        $capability,
                        sprintf('%s is a GET but requires "%s".', $definition->name, $capability)
                    );
                }
            }
        }
    }

    /**
     * The mirror of the above: a write must not be offered on a read-only
     * capability, or an administrator with view rights alone would be shown a
     * tool that 403s the moment it runs.
     */
    public function testWriteToolsRequireMutatingCapabilities(): void
    {
        foreach (AdminTools::all() as $definition) {
            if ($definition->isRead()) {
                continue;
            }

            $this->assertNotEmpty($definition->permissions, $definition->name . ' mutates but declares no capability.');

            foreach ($definition->permissions as $capability) {
                $this->assertStringNotContainsString(
                    '.read',
                    $capability,
                    sprintf('%s mutates but only requires "%s".', $definition->name, $capability)
                );
            }
        }
    }

    /**
     * Collapse route parameter names so `/users/{user}` and `/users/{user:id}`
     * compare equal — the tool template names the binding, the route names the
     * column it resolves against.
     */
    private function normalise(string $uri): string
    {
        return preg_replace('/\{[^}]+\}/', '{}', $uri) ?? $uri;
    }
}
