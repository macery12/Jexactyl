<?php

namespace Everest\Providers;

use Carbon\Carbon;
use Everest\Models;
use Everest\Models\User;
use Illuminate\Support\Str;
use Dedoc\Scramble\Scramble;
use Illuminate\Support\Facades\URL;
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\SecurityScheme;
use Illuminate\Database\Eloquent\Relations\Relation;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Schema::defaultStringLength(191);

        Paginator::useBootstrap();

        // If the APP_URL value is set with https:// make sure we force it here. Theoretically
        // this should just work with the proxy logic, but there are a lot of cases where it
        // doesn't, and it triggers a lot of support requests, so lets just head it off here.
        //
        // @see https://github.com/pterodactyl/panel/issues/3623
        if (Str::startsWith(config('app.url') ?? '', 'https://')) {
            URL::forceScheme('https');
        }

        Relation::enforceMorphMap([
            'allocation' => Models\Allocation::class,
            'api_key' => Models\ApiKey::class,
            'backup' => Models\Backup::class,
            'database' => Models\Database::class,
            'egg' => Models\Egg::class,
            'egg_variable' => Models\EggVariable::class,
            'schedule' => Models\Schedule::class,
            'server' => Models\Server::class,
            'ssh_key' => Models\UserSSHKey::class,
            'ticket' => Models\Ticket::class,
            'task' => Models\Task::class,
            'link' => Models\CustomLink::class,
            'user' => User::class,
        ]);

        Carbon::serializeUsing(fn ($carbon) => $carbon->utc()->toIso8601ZuluString());

        if (class_exists(\Dedoc\Scramble\ScrambleServiceProvider::class) && is_dir(base_path('vendor/dedoc/scramble/resources/views'))) {
            View::addNamespace('scramble', base_path('vendor/dedoc/scramble/resources/views'));
        }

        if (class_exists(Scramble::class)) {
            Scramble::routes(function ($route) {
                $uri = trim($route->uri, '/');

                if (!Str::startsWith($uri, config('scramble.api_path', 'api'))) {
                    return false;
                }

                if (Str::startsWith($uri, ['api/docs', 'api/openapi.json', 'docs/api', 'docs/api.json'])) {
                    return false;
                }

                if (!config('api-docs.include_remote_routes', false) && Str::startsWith($uri, 'api/remote')) {
                    return false;
                }

                // Hide internal receivers / machine-to-machine endpoints that a
                // user never calls with an API token (webhook callbacks, the
                // public storefront feed). See config/api-docs.php.
                if (Str::startsWith($uri, config('api-docs.exclude_prefixes', []))) {
                    return false;
                }

                return true;
            });

            Scramble::extendOpenApi(function (OpenApi $openApi) {
                $openApi->secure(
                    SecurityScheme::http('bearer', 'Token')
                        ->as('BearerToken')
                        ->setDescription('Use Bearer {token} with API keys or admin sessions.')
                        ->default()
                );
            });
        }
    }

    /**
     * Register application service providers.
     */
    public function register(): void
    {
        // If no APP_KEY is defined, provide a null encrypter so console commands
        // like key:generate can still execute without crashing during boot.
        if (blank(config('app.key')) && $this->app->runningInConsole()) {
            $this->app->singleton('encrypter', function () {
                return new class () implements \Illuminate\Contracts\Encryption\Encrypter {
                    public function encrypt($value, $serialize = true)
                    {
                        return $value;
                    }

                    public function decrypt($payload, $unserialize = true)
                    {
                        return $payload;
                    }

                    public function encryptString($value)
                    {
                        return $value;
                    }

                    public function decryptString($payload)
                    {
                        return $payload;
                    }

                    public function getKey()
                    {
                        return '';
                    }

                    public function getAllKeys(): array
                    {
                        return [];
                    }

                    public function getPreviousKeys(): array
                    {
                        return [];
                    }
                };
            });
        }

        // Only load the settings / theme service provider if the environment
        // is configured to allow it.
        if (!config('everest.load_environment_only', false) && $this->app->environment() !== 'testing') {
            $this->app->register(SettingsServiceProvider::class);
            $this->app->register(ThemeServiceProvider::class);
        }
    }
}
