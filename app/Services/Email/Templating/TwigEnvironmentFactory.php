<?php

namespace Everest\Services\Email\Templating;

use Twig\Environment;
use Twig\Loader\ArrayLoader;
use Twig\Loader\ChainLoader;
use Twig\Cache\FilesystemCache;
use Twig\Loader\FilesystemLoader;
use Twig\Extension\SandboxExtension;

class TwigEnvironmentFactory
{
    /**
     * Relative to resource_path(). The loader is rooted here and nowhere else -- this is
     * the boundary that stops `{% extends %}` / `{% include %}` from reaching templates
     * outside the email tree, so do not widen it to the whole views directory.
     */
    public const TEMPLATE_ROOT = 'views/emails';

    public const EXTENSION = '.twig';

    /**
     * Compiled templates land here. Kept out of the Blade cache so `view:clear` and the
     * Twig cache stay independent.
     */
    public const CACHE_PATH = 'framework/twig';

    /**
     * Build an environment for one render.
     *
     * When an operator override is in play its source is passed in and takes precedence
     * over the file of the same logical name, so the override participates in the normal
     * inheritance chain -- it can still `{% extends %}` the trusted layout, which is
     * resolved from disk.
     */
    public function make(?string $overrideName = null, ?string $overrideSource = null): Environment
    {
        $filesystem = new FilesystemLoader([resource_path(self::TEMPLATE_ROOT)]);

        $loader = $overrideName !== null && $overrideSource !== null
            ? new ChainLoader([new ArrayLoader([$overrideName => $overrideSource]), $filesystem])
            : $filesystem;

        $twig = new Environment($loader, [
            // Explicit rather than relying on the default, because email bodies are
            // operator-editable and the escaping strategy is load-bearing.
            'autoescape' => 'html',
            // An undefined variable renders empty instead of throwing. A template that
            // references a variable the event did not supply should still deliver;
            // save-time validation is where authoring mistakes get caught.
            'strict_variables' => false,
            'cache' => new FilesystemCache(storage_path(self::CACHE_PATH)),
            'auto_reload' => true,
            'debug' => false,
        ]);

        $twig->addExtension(new SandboxExtension(new EmailSandboxPolicy(), true));

        return $twig;
    }

    /**
     * Translate a Laravel view name ("emails.auth.password-reset") into a loader template
     * name ("auth/password-reset.twig").
     *
     * Rejects anything outside a conservative character set so no traversal sequence can
     * reach the loader. Returns null when the name is not usable.
     */
    public static function templateName(string $view): ?string
    {
        if (!preg_match('/^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*$/i', $view)) {
            return null;
        }

        $relative = str_starts_with($view, 'emails.') ? substr($view, strlen('emails.')) : $view;

        if ($relative === '') {
            return null;
        }

        return str_replace('.', '/', $relative) . self::EXTENSION;
    }
}
