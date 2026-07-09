<?php

use Illuminate\Support\Facades\Route;
use Everest\Http\Controllers\Api\Client;
use Everest\Http\Middleware\SuspendedAccount;
use Everest\Http\Middleware\JGuardPendingAccount;
use Everest\Http\Middleware\Activity\ServerSubject;
use Everest\Http\Middleware\Activity\AccountSubject;
use Everest\Http\Middleware\RequireTwoFactorAuthentication;
use Everest\Http\Middleware\Api\Client\Server\ResourceBelongsToServer;
use Everest\Http\Middleware\Api\Client\Server\AuthenticateServerAccess;

/*
|--------------------------------------------------------------------------
| Client Control API
|--------------------------------------------------------------------------
|
| Endpoint: /api/client
|
*/

Route::prefix('/')->middleware([SuspendedAccount::class, JGuardPendingAccount::class])->group(function () {
    Route::get('/', [Client\ClientController::class, 'index'])->name('api:client.index');
    Route::get('/permissions', [Client\ClientController::class, 'permissions']);
    Route::get('links', [Client\LinkController::class, 'index']);
    Route::get('/alerts', [Client\AlertController::class, 'index']);

    Route::prefix('/groups')->group(function () {
        Route::get('/', [Client\ServerGroupController::class, 'index']);
        Route::post('/', [Client\ServerGroupController::class, 'store']);

        Route::patch('/{id}', [Client\ServerGroupController::class, 'update']);
        Route::delete('/{id}', [Client\ServerGroupController::class, 'delete']);

        Route::post('/{id}/add', [Client\ServerGroupController::class, 'add']);
        Route::post('/{id}/remove', [Client\ServerGroupController::class, 'remove']);
    });

    Route::prefix('/account')->middleware(AccountSubject::class)->group(function () {
        Route::prefix('/')->withoutMiddleware(RequireTwoFactorAuthentication::class)->group(function () {
            Route::get('/', [Client\AccountController::class, 'index'])
                ->middleware('verified.view:credentials')
                ->name('api:client.account');
            Route::get('/two-factor', [Client\TwoFactorController::class, 'index'])->middleware('verified.view:credentials');
            Route::post('/two-factor', [Client\TwoFactorController::class, 'store'])->middleware('verified.interact:credentials');
            Route::post('/two-factor/disable', [Client\TwoFactorController::class, 'delete'])->middleware('verified.interact:credentials');

            Route::get('/recovery-code', [Client\RecoveryCodeController::class, 'index'])->middleware('verified.view:credentials');
            Route::post('/recovery-code', [Client\RecoveryCodeController::class, 'store'])
                ->middleware(['verified.interact:credentials', 'throttle:6,1']);
            Route::post('/recovery-code/acknowledge', [Client\RecoveryCodeController::class, 'acknowledge'])
                ->middleware('verified.interact:credentials');
        });

        Route::put('/email', [Client\AccountController::class, 'updateEmail'])
            ->name('api:client.account.update-email');
        Route::put('/password', [Client\AccountController::class, 'updatePassword'])
            ->name('api:client.account.update-password');
        Route::post('/email/verification', [Client\EmailVerificationController::class, 'send'])
            ->name('api:client.account.email-verification')
            ->middleware('throttle:email-verification');

        Route::post('/discord/link', [\Everest\Http\Controllers\Auth\Modules\DiscordLoginController::class, 'requestLinkToken'])
            ->name('api:client.account.discord.link');
        Route::post('/discord/unlink', [\Everest\Http\Controllers\Auth\Modules\DiscordLoginController::class, 'unlinkDiscord'])
            ->name('api:client.account.discord.unlink');

        Route::get('/activity', Client\ActivityLogController::class)
            ->middleware('verified.view:credentials')
            ->name('api:client.account.activity');

        Route::get('/owned-servers', [Client\ActivityLogController::class, 'servers'])
            ->middleware('verified.view:credentials')
            ->name('api:client.account.owned-servers');

        Route::prefix('/sessions')->group(function () {
            Route::get('/', [Client\SessionController::class, 'index'])
                ->middleware('verified.view:credentials')
                ->name('api:client.account.sessions');
            Route::get('/history', [Client\SessionController::class, 'history'])
                ->middleware('verified.view:credentials')
                ->name('api:client.account.sessions.history');
            Route::post('/{session}/revoke', [Client\SessionController::class, 'revoke'])
                ->middleware('verified.interact:credentials')
                ->name('api:client.account.sessions.revoke');
            Route::patch('/{session}/label', [Client\SessionController::class, 'updateLabel'])
                ->middleware('verified.interact:credentials')
                ->name('api:client.account.sessions.label');
            Route::post('/revoke-all', [Client\SessionController::class, 'revokeAll'])
                ->middleware('verified.interact:credentials')
                ->name('api:client.account.sessions.revoke-all');
        });

        Route::get('/api-keys', [Client\ApiKeyController::class, 'index'])->middleware('verified.view:credentials');
        Route::post('/api-keys', [Client\ApiKeyController::class, 'store'])->middleware('verified.interact:credentials');
        Route::delete('/api-keys/{identifier}', [Client\ApiKeyController::class, 'delete'])->middleware('verified.interact:credentials');

        Route::prefix('/ssh-keys')->group(function () {
            Route::get('/', [Client\SSHKeyController::class, 'index'])->middleware('verified.view:credentials');
            Route::post('/', [Client\SSHKeyController::class, 'store'])->middleware('verified.interact:credentials');
            Route::post('/remove', [Client\SSHKeyController::class, 'delete'])->middleware('verified.interact:credentials');
        });

        Route::prefix('/tickets')->group(function () {
            Route::middleware('verified.view:tickets')->group(function () {
                Route::get('/', [Client\TicketController::class, 'index']);
                Route::get('/{ticket:id}', [Client\TicketController::class, 'view']);
            });

            Route::middleware('verified.interact:tickets')->group(function () {
                Route::post('/', [Client\TicketController::class, 'store']);
                Route::delete('/{ticket:id}', [Client\TicketController::class, 'delete']);
                Route::post('/{ticket:id}/messages', [Client\TicketController::class, 'message']);
            });
        });

        Route::post('/setup', [Client\AccountController::class, 'setup']);
    });

    Route::prefix('/billing')->group(function () {
        Route::post('/nodes/{product:id}', [Client\Billing\NodesController::class, 'index']);
        Route::get('/categories', [Client\Billing\CategoryController::class, 'index']);
        Route::get('/custom-domains/options', [Client\Billing\CustomDomainOptionsController::class, 'index'])
            ->middleware('throttle:custom-domains-billing-options');

        Route::get('/categories/{id}', [Client\Billing\ProductController::class, 'index']);
        Route::get('/products/{id}', [Client\Billing\ProductController::class, 'view']);
        Route::get('/products/{id}/variables', [Client\Billing\EggController::class, 'index']);
        Route::get('/eggs/{id}', [Client\Billing\EggController::class, 'getEgg']);

        // Unified checkout controller for both free and paid products
        Route::get('/products/{id}/key', [Client\Billing\CheckoutController::class, 'getStripeKey']);
        Route::middleware('verified.view:billing')->group(function () {
            Route::post('/nodes/{product:id}', [Client\Billing\NodesController::class, 'index']);
            Route::get('/categories', [Client\Billing\CategoryController::class, 'index']);

            Route::get('/categories/{id}', [Client\Billing\ProductController::class, 'index']);
            Route::get('/products/{id}', [Client\Billing\ProductController::class, 'view']);
            Route::get('/products/{id}/variables', [Client\Billing\EggController::class, 'index']);
            Route::get('/eggs/{id}', [Client\Billing\EggController::class, 'getEgg']);
            Route::get('/products/{id}/billing-cycles', [Client\Billing\BillingCycleController::class, 'index']);

            // Cancel a PayPal order — only requires view permission (no purchase interaction needed)
            Route::post('/paypal/cancel', [Client\Billing\PayPalCheckoutController::class, 'cancelOrder']);
        });

        Route::middleware(['verified.view:billing', 'verified.interact:billing'])->group(function () {
            // Unified checkout controller for both free and paid products
            Route::get('/products/{id}/key', [Client\Billing\CheckoutController::class, 'getStripeKey']);

            Route::post('/products/{id}/intent', [Client\Billing\CheckoutController::class, 'createIntent']);
            Route::put('/products/{id}/intent', [Client\Billing\CheckoutController::class, 'updateIntent']);

            // PayPal payment routes
            Route::post('/products/{id}/paypal/order', [Client\Billing\PayPalCheckoutController::class, 'createOrder']);
            Route::put('/products/{id}/paypal/order', [Client\Billing\PayPalCheckoutController::class, 'updateOrder']);
            Route::post('/paypal/capture', [Client\Billing\PayPalCheckoutController::class, 'captureOrder']);
            Route::get('/paypal/status', [Client\Billing\PayPalCheckoutController::class, 'checkOrderStatus']);
            Route::get('/paypal/token/{token}', [Client\Billing\PayPalCheckoutController::class, 'getOrderFromToken']);
            Route::get('/paypal/orders/{order}/redirect', [Client\Billing\PayPalCheckoutController::class, 'redirectToApproval']);

            Route::post('/coupons/validate', [Client\Billing\CouponController::class, 'validateCoupon']);

            Route::post('/process', [Client\Billing\CheckoutController::class, 'processPaid'])->name('api:client.billing.process');
            Route::post('/process/free', [Client\Billing\CheckoutController::class, 'processFree']);
            Route::post('/renew/free', [Client\Billing\CheckoutController::class, 'renewFree']);
        });

        Route::middleware('verified.view:orders')->group(function () {
            Route::get('/orders', [Client\Billing\OrderController::class, 'index']);
            Route::get('/orders/{id}', [Client\Billing\OrderController::class, 'view']);

            // Invoice routes
            Route::get('/invoices', [Client\Billing\InvoiceController::class, 'index']);
            Route::get('/invoices/{uuid}/download', [Client\Billing\InvoiceController::class, 'download']);
            Route::get('/invoices/{uuid}/serve', [Client\Billing\InvoiceController::class, 'serve']);
        });

        // Billing profile (PII — stored encrypted)
        Route::get('/profile', [Client\Billing\BillingProfileController::class, 'show']);
        Route::post('/profile', [Client\Billing\BillingProfileController::class, 'store']);
        Route::put('/profile', [Client\Billing\BillingProfileController::class, 'update']);

        // Address autocomplete proxy (Nominatim)
        Route::get('/address-autocomplete', [Client\Billing\AddressAutocompleteController::class, 'search'])
            ->middleware('throttle:30,1');
    });

    /*
    |--------------------------------------------------------------------------
    | Client Control API
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/client/servers/{server}
    |
    */
    Route::group([
        'prefix' => '/servers/{server}',
        'middleware' => [
            ServerSubject::class,
            AuthenticateServerAccess::class,
            ResourceBelongsToServer::class,
        ],
    ], function () {
        Route::get('/', [Client\Servers\ServerController::class, 'index'])->name('api:client:server.view');
        Route::get('/websocket', Client\Servers\WebsocketController::class)->name('api:client:server.ws');
        Route::get('/resources', Client\Servers\ResourceUtilizationController::class)->name('api:client:server.resources');
        Route::get('/activity', Client\Servers\ActivityLogController::class)->name('api:client:server.activity');
        Route::get('/activity/users', [Client\Servers\ActivityLogController::class, 'users']);
        Route::get('/activity/events', [Client\Servers\ActivityLogController::class, 'events']);

        Route::group(['prefix' => '/plugins'], function () {
            Route::get('/providers', [Client\Servers\PluginProviderController::class, 'index']);
            Route::get('/capabilities', [Client\Servers\PluginProviderController::class, 'capabilities']);
            Route::get('/installed', [Client\Servers\ModsController::class, 'installed']);
            Route::post('/installed/toggle', [Client\Servers\ModsController::class, 'toggleInstalledAddon']);
        });

        Route::post('/command', [Client\Servers\CommandController::class, 'index']);
        Route::post('/power', [Client\Servers\PowerController::class, 'index']);
        Route::post('/ai', [Client\Servers\AIController::class, 'index']);

        Route::prefix('/ai/conversations')->group(function () {
            Route::get('/', [Client\Servers\AIConversationController::class, 'index']);
            Route::post('/', [Client\Servers\AIConversationController::class, 'store']);
            Route::get('/{conversationId}', [Client\Servers\AIConversationController::class, 'show']);
            Route::delete('/{conversationId}', [Client\Servers\AIConversationController::class, 'destroy']);
            Route::patch('/{conversationId}/save', [Client\Servers\AIConversationController::class, 'toggleSave']);
            Route::post('/{conversationId}/messages', [Client\Servers\AIConversationController::class, 'appendMessages']);
        });

        Route::group(['prefix' => '/databases'], function () {
            Route::get('/', [Client\Servers\DatabaseController::class, 'index']);
            Route::post('/', [Client\Servers\DatabaseController::class, 'store']);
            Route::post('/{database}/rotate-password', [Client\Servers\DatabaseController::class, 'rotatePassword']);
            Route::delete('/{database}', [Client\Servers\DatabaseController::class, 'delete']);
        });

        Route::group(['prefix' => '/files'], function () {
            Route::get('/list', [Client\Servers\FileController::class, 'directory']);
            Route::get('/contents', [Client\Servers\FileController::class, 'contents']);
            Route::get('/download', [Client\Servers\FileController::class, 'download']);
            Route::put('/rename', [Client\Servers\FileController::class, 'rename']);
            Route::post('/copy', [Client\Servers\FileController::class, 'copy']);
            Route::post('/write', [Client\Servers\FileController::class, 'write']);
            Route::post('/write-with-diff', [Client\Servers\FileController::class, 'writeWithDiff']);
            Route::post('/compress', [Client\Servers\FileController::class, 'compress']);
            Route::post('/decompress', [Client\Servers\FileController::class, 'decompress']);
            Route::post('/delete', [Client\Servers\FileController::class, 'delete']);
            Route::post('/create-folder', [Client\Servers\FileController::class, 'create']);
            Route::post('/chmod', [Client\Servers\FileController::class, 'chmod']);
            Route::post('/pull', [Client\Servers\FileController::class, 'pull'])->middleware(['throttle:10,5']);
            Route::get('/upload', Client\Servers\FileUploadController::class);
        });

        Route::group(['prefix' => '/mods'], function () {
            Route::get('/search', [Client\Servers\ModsController::class, 'search'])->middleware(['throttle:mods.browse']);
            Route::get('/providers', [Client\Servers\ModsController::class, 'providerAccess']);
            Route::get('/server-config', [Client\Servers\ModsController::class, 'serverConfig']);
            Route::get('/minecraft/versions', [Client\Servers\ModsController::class, 'getMinecraftVersions'])->middleware(['throttle:mods.meta']);
            Route::get('/minecraft/loaders', [Client\Servers\ModsController::class, 'getModLoaderTypes'])->middleware(['throttle:mods.meta']);

            // Download queue management — must be declared before /{modId} wildcard
            Route::get('/queue', [Client\Servers\ModQueueController::class, 'index']);
            Route::post('/queue/bulk-clear', [Client\Servers\ModQueueController::class, 'bulkClear']);
            Route::delete('/queue/{queueUuid}', [Client\Servers\ModQueueController::class, 'cancel']);
            Route::post('/queue/{queueUuid}/retry', [Client\Servers\ModQueueController::class, 'retry']);

            // Modpack routes — declared before wildcard /{modId}
            Route::prefix('/modpacks')->group(function () {
                Route::get('/search', [Client\Servers\ModpackController::class, 'search'])->middleware(['throttle:mods.browse']);
                Route::get('/minecraft-versions', [Client\Servers\ModpackController::class, 'minecraftVersions'])->middleware(['throttle:mods.meta']);
                Route::get('/loader-status', [Client\Servers\ModpackController::class, 'loaderStatus'])->middleware(['throttle:mods.meta']);
                Route::post('/{projectId}/versions/{versionId}/preview', [Client\Servers\ModpackController::class, 'preview'])->middleware(['throttle:mods.browse']);
                Route::post('/{projectId}/versions/{versionId}/install', [Client\Servers\ModpackController::class, 'install']);
                Route::get('/{projectId}/versions', [Client\Servers\ModpackController::class, 'versions'])->middleware(['throttle:mods.browse']);
                Route::get('/{projectId}', [Client\Servers\ModpackController::class, 'show'])->middleware(['throttle:mods.browse']);
            });

            // Wildcard mod routes last so static paths above are not swallowed
            Route::get('/{modId}', [Client\Servers\ModsController::class, 'getMod'])->middleware(['throttle:mods.browse']);
            Route::get('/{modId}/files', [Client\Servers\ModsController::class, 'getModFiles'])->middleware(['throttle:mods.browse']);
            Route::post('/{modId}/files/{fileId}/download', [Client\Servers\ModsController::class, 'downloadMod'])->middleware(['throttle:mods.download']);
        });

        Route::group(['prefix' => '/schedules'], function () {
            Route::get('/', [Client\Servers\ScheduleController::class, 'index']);
            Route::post('/', [Client\Servers\ScheduleController::class, 'store']);
            Route::get('/{schedule}', [Client\Servers\ScheduleController::class, 'view']);
            Route::post('/{schedule}', [Client\Servers\ScheduleController::class, 'update']);
            Route::post('/{schedule}/execute', [Client\Servers\ScheduleController::class, 'execute']);
            Route::delete('/{schedule}', [Client\Servers\ScheduleController::class, 'delete']);

            Route::post('/{schedule}/tasks', [Client\Servers\ScheduleTaskController::class, 'store']);
            Route::post('/{schedule}/tasks/{task}', [Client\Servers\ScheduleTaskController::class, 'update']);
            Route::delete('/{schedule}/tasks/{task}', [Client\Servers\ScheduleTaskController::class, 'delete']);
        });

        Route::group(['prefix' => '/network'], function () {
            Route::get('/allocations', [Client\Servers\NetworkAllocationController::class, 'index']);
            Route::post('/allocations', [Client\Servers\NetworkAllocationController::class, 'store']);
            Route::post('/allocations/{allocation}', [Client\Servers\NetworkAllocationController::class, 'update']);
            Route::post('/allocations/{allocation}/primary', [Client\Servers\NetworkAllocationController::class, 'setPrimary']);
            Route::delete('/allocations/{allocation}', [Client\Servers\NetworkAllocationController::class, 'delete']);
        });

        Route::group(['prefix' => '/custom-domains'], function () {
            Route::get('/', [Client\Servers\CustomDomainController::class, 'index']);
            Route::get('/options', [Client\Servers\CustomDomainController::class, 'options']);
            Route::post('/', [Client\Servers\CustomDomainController::class, 'store'])
                ->middleware('throttle:custom-domains-create');
            Route::post('/sync', [Client\Servers\CustomDomainController::class, 'sync'])
                ->middleware('throttle:custom-domains-sync');
            Route::delete('/{customDomain:id}', [Client\Servers\CustomDomainController::class, 'destroy']);
        });

        Route::group(['prefix' => '/users'], function () {
            Route::get('/', [Client\Servers\SubuserController::class, 'index']);
            Route::post('/', [Client\Servers\SubuserController::class, 'store']);
            Route::get('/{user}', [Client\Servers\SubuserController::class, 'view']);
            Route::post('/{user}', [Client\Servers\SubuserController::class, 'update']);
            Route::delete('/{user}', [Client\Servers\SubuserController::class, 'delete']);
        });

        Route::group(['prefix' => '/backups'], function () {
            Route::get('/', [Client\Servers\BackupController::class, 'index']);
            Route::post('/', [Client\Servers\BackupController::class, 'store']);
            Route::get('/{backup}', [Client\Servers\BackupController::class, 'view']);
            Route::get('/{backup}/download', [Client\Servers\BackupController::class, 'download']);
            Route::post('/{backup}/lock', [Client\Servers\BackupController::class, 'toggleLock']);
            Route::post('/{backup}/restore', [Client\Servers\BackupController::class, 'restore']);
            Route::delete('/{backup}', [Client\Servers\BackupController::class, 'delete']);
        });

        Route::group(['prefix' => '/startup'], function () {
            Route::get('/', [Client\Servers\StartupController::class, 'index']);
            Route::get('/versions', [Client\Servers\StartupController::class, 'versions']);
            Route::put('/variable', [Client\Servers\StartupController::class, 'update']);
        });

        Route::group(['prefix' => '/settings'], function () {
            Route::post('/rename', [Client\Servers\SettingsController::class, 'rename']);
            Route::post('/reinstall', [Client\Servers\SettingsController::class, 'reinstall']);
            Route::put('/docker-image', [Client\Servers\SettingsController::class, 'dockerImage']);
            Route::post('/change-egg', [Client\Servers\SettingsController::class, 'changeEgg']);
        });

        Route::group(['prefix' => '/billing'], function () {
            Route::get('/plans', [Client\Billing\PlanChangeController::class, 'getAvailablePlans']);
            Route::get('/plans/{product}/validate', [Client\Billing\PlanChangeController::class, 'validatePlanChange']);
            Route::post('/plans/{product}/change', [Client\Billing\PlanChangeController::class, 'changePlan']);
        });

        // Wings-RS (Supercharged) endpoints
        Route::group(['prefix' => '/wings-rs'], function () {
            Route::get('/status', [Client\Servers\WingsRsController::class, 'status']);
            Route::post('/fingerprints', [Client\Servers\WingsRsController::class, 'fingerprints'])
                ->middleware('throttle:wings-rs.fingerprints');
            Route::post('/search', [Client\Servers\WingsRsController::class, 'searchFiles'])
                ->middleware('throttle:wings-rs.search');
            Route::post('/compress', [Client\Servers\WingsRsController::class, 'compressAdvanced'])
                ->middleware('throttle:wings-rs.compress');
            Route::delete('/operations/{operation}', [Client\Servers\WingsRsController::class, 'cancelOperation'])
                ->where('operation', '[a-zA-Z0-9\-]{1,64}');
            Route::post('/script', [Client\Servers\WingsRsController::class, 'runScript'])
                ->middleware('throttle:wings-rs.script');
            Route::post('/abort-install', [Client\Servers\WingsRsController::class, 'abortInstall']);
            Route::get('/install-logs', [Client\Servers\WingsRsController::class, 'installLogs']);
            Route::get('/ssh', [Client\Servers\WingsRsController::class, 'sshInfo']);
        });

        Route::group(['prefix' => '/deletion'], function () {
            Route::post('/schedule', [Client\Servers\DeletionScheduleController::class, 'schedule']);
            Route::post('/cancel', [Client\Servers\DeletionScheduleController::class, 'cancel']);
        });

        /*
        |--------------------------------------------------------------------------
        | Extensions Routes
        |--------------------------------------------------------------------------
        */
        Route::group(['prefix' => '/extensions'], function () {
            // List enabled extensions for this server
            Route::get('/', [Client\Extensions\ExtensionsController::class, 'index']);

            // Extension-specific routes (must come before the wildcard route)
            foreach ((glob(__DIR__ . '/extensions/client/*.php') ?: []) as $extensionRoutes) {
                require $extensionRoutes;
            }
            foreach ((glob(app_path('Extensions/Packages/*/routes/client.php')) ?: []) as $extensionRoutes) {
                require $extensionRoutes;
            }

            // Extension check route (must come AFTER specific extension routes)
            Route::get('/{extensionId}', [Client\Extensions\ExtensionsController::class, 'check']);
        });
    });
});
