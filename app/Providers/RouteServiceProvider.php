<?php

namespace Everest\Providers;

use Everest\Models\Database;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Everest\Http\Middleware\TrimStrings;
use Illuminate\Cache\RateLimiting\Limit;
use Everest\Http\Middleware\ApiDocsAccess;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Http\Middleware\AdminAuthenticate;
use Everest\Http\Middleware\RequireTwoFactorAuthentication;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;

class RouteServiceProvider extends ServiceProvider
{
    protected const FILE_PATH_REGEX = '/^\/api\/client\/servers\/([a-z0-9-]{36})\/files(\/?$|\/(.)*$)/i';

    /**
     * Define your route model bindings, pattern filters, etc.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();

        // Disable trimming string values when requesting file information — it isn't helpful
        // and messes up the ability to actually open a directory that ends with a space.
        TrimStrings::skipWhen(function (Request $request) {
            return preg_match(self::FILE_PATH_REGEX, $request->getPathInfo()) === 1;
        });

        // This is needed to make use of the "resolveRouteBinding" functionality in the
        // model. Without it, you'll never trigger that logic flow thus resulting in a 404
        // error because we request databases with a HashID, and not with a normal ID.
        Route::model('database', Database::class);

        $this->routes(function () {
            Route::middleware('web')->group(function () {
                // Admin keeps V1's server-side gates: a guest or non-admin never
                // receives the admin shell.
                Route::middleware(['auth.session', RequireTwoFactorAuthentication::class, AdminAuthenticate::class])
                    ->prefix('/admin')
                    ->group(base_path('routes/admin.php'));

                Route::middleware('guest')->prefix('/auth')->group(base_path('routes/auth.php'));

                // Site root: V2 shell, web-only (no auth) — the landing page must
                // render for guests and the SPA guards authenticated areas itself;
                // the API (below) enforces auth + 2FA server-side.
                Route::group([], base_path('routes/base.php'));
            });

            Route::middleware(['api', RequireTwoFactorAuthentication::class])->group(function () {
                Route::middleware(['application-api', 'throttle:api.application'])
                    ->prefix('/api/application')
                    ->scopeBindings()
                    ->group(base_path('routes/api-application.php'));

                Route::middleware(['client-api', 'throttle:api.client'])
                    ->prefix('/api/client')
                    ->scopeBindings()
                    ->group(base_path('routes/api-client.php'));
            });

            Route::middleware($this->apiDocsMiddleware())
                ->prefix('/api')
                ->group(base_path('routes/api-docs.php'));

            Route::middleware('daemon')
                ->prefix('/api/remote')
                ->scopeBindings()
                ->group(base_path('routes/api-remote.php'));

            // Payment webhooks - no authentication required
            Route::prefix('/api')
                ->group(base_path('routes/webhooks.php'));

            // Public read-only API (storefront catalog for the landing page) -
            // no authentication, IP rate-limited.
            Route::prefix('/api')
                ->group(base_path('routes/api-public.php'));
        });
    }

    /**
     * Configure the rate limiters for the application.
     */
    protected function configureRateLimiting(): void
    {
        // Authentication rate limiting. For login and checkpoint endpoints we'll apply
        // a limit of 10 requests per minute, for the forgot password endpoint apply a
        // limit of two per minute for the requester so that there is less ability to
        // trigger email spam.
        RateLimiter::for('authentication', function (Request $request) {
            if ($request->route()->named('auth.post.forgot-password')) {
                return Limit::perMinute(2)->by($request->ip());
            }

            return Limit::perMinute(10);
        });

        // Configure the throttles for both the application and client APIs below.
        // This is configurable per-instance in "config/http.php". By default this
        // limiter will be tied to the specific request user, and falls back to the
        // request IP if there is no request user present for the key.
        //
        // This means that an authenticated API user cannot use IP switching to get
        // around the limits.
        RateLimiter::for('api.client', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinutes(
                config('http.rate_limit.client_period'),
                config('http.rate_limit.client')
            )->by($key);
        });

        RateLimiter::for('api.application', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinutes(
                config('http.rate_limit.application_period'),
                config('http.rate_limit.application')
            )->by($key);
        });

        // Extension-contributed admin routes get their own, tighter budget so a
        // chatty extension dashboard cannot exhaust the global application
        // limit above (which still applies on top). Keyed per user *and* per
        // extension — one extension hitting its limit never 429s another.
        RateLimiter::for('api.ext-admin', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            $extensionId = preg_match('~extensions/ext/([^/]+)~', $request->path(), $matches) === 1
                ? $matches[1]
                : 'unknown';

            return Limit::perMinutes(
                config('http.rate_limit.ext_admin_period'),
                config('http.rate_limit.ext_admin')
            )->by('ext-admin:' . $extensionId . ':' . $key);
        });

        RateLimiter::for('file.diff', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinutes(
                max(1, (int) config('http.rate_limit.file_diff_period', 1)),
                max(1, (int) config('http.rate_limit.file_diff', 10))
            )->by('file-diff:' . $key)->response(function () {
                return response()->json([
                    'errors' => [
                        [
                            'code' => 'ThrottleRequestsException',
                            'status' => '429',
                            'detail' => 'Too many file diff requests. Please wait before saving again.',
                        ],
                    ],
                ], 429);
            });
        });

        RateLimiter::for('password-reset-ip', fn (Request $request) => Limit::perMinutes(3, 20)->by($request->ip()));

        RateLimiter::for('password-reset-email', function (Request $request) {
            $email = strtolower((string) $request->input('email', ''));

            return Limit::perMinutes(5, 20)->by($email !== '' ? $email : $request->ip());
        });

        RateLimiter::for('custom-domains-create', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();
            $limit = max(1, (int) config('modules.custom_domains.rate_limits.create_per_minute', 10));

            return Limit::perMinute($limit)->by($key);
        });

        RateLimiter::for('custom-domains-sync', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();
            $limit = max(1, (int) config('modules.custom_domains.rate_limits.sync_per_minute', 5));

            return Limit::perMinute($limit)->by($key);
        });

        RateLimiter::for('custom-domains-billing-options', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();
            $limit = max(1, (int) config('modules.custom_domains.rate_limits.billing_options_per_minute', 20));

            return Limit::perMinute($limit)->by($key);
        });
        RateLimiter::for('email-verification', function (Request $request) {
            $key = optional($request->user())->id ?: $request->ip();

            return Limit::perMinute(1)->by($key);
        });

        RateLimiter::for('mods.browse', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(120)->by($key)->response(function () {
                return response()->json([
                    'errors' => [
                        [
                            'code' => 'ThrottleRequestsException',
                            'status' => '429',
                            'detail' => 'Too many mod requests. Please wait a few seconds and try again.',
                        ],
                    ],
                ], 429);
            });
        });

        RateLimiter::for('mods.meta', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(240)->by($key)->response(function () {
                return response()->json([
                    'errors' => [
                        [
                            'code' => 'ThrottleRequestsException',
                            'status' => '429',
                            'detail' => 'Too many metadata requests. Please try again shortly.',
                        ],
                    ],
                ], 429);
            });
        });

        // Soft HTTP-layer cap for download submissions — real rate limiting is enforced inside the controller.
        RateLimiter::for('mods.download', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(60)->by($key)->response(function () {
                return response()->json([
                    'errors' => [
                        [
                            'code' => 'ThrottleRequestsException',
                            'status' => '429',
                            'detail' => 'Too many download requests. Please wait before submitting more.',
                        ],
                    ],
                ], 429);
            });
        });

        RateLimiter::for('wings-rs.search', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(30)->by($key);
        });

        RateLimiter::for('wings-rs.compress', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(10)->by($key);
        });

        RateLimiter::for('wings-rs.fingerprints', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(30)->by($key);
        });

        RateLimiter::for('wings-rs.script', function (Request $request) {
            $key = optional($request->user())->uuid ?: $request->ip();

            return Limit::perMinute(5)->by($key);
        });

        // Public storefront catalog — unauthenticated, so it must be keyed purely
        // by IP. Kept generous enough for normal browsing but tight enough to blunt
        // scraping/abuse of the public endpoint.
        RateLimiter::for('storefront.read', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip())->response(function () {
                return response()->json([
                    'errors' => [
                        [
                            'code' => 'ThrottleRequestsException',
                            'status' => '429',
                            'detail' => 'Too many requests. Please wait a moment and try again.',
                        ],
                    ],
                ], 429);
            });
        });
    }

    private function apiDocsMiddleware(): array
    {
        $middleware = [
            'web',
            'auth.session',
            ApiDocsAccess::class,
        ];

        if (config('api-docs.admin_only')) {
            $middleware[] = RequireTwoFactorAuthentication::class;
            $middleware[] = AdminAuthenticate::class;
        }

        return $middleware;
    }
}
