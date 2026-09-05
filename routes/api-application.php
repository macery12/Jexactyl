<?php

use Illuminate\Support\Facades\Route;
use Everest\Http\Controllers\Api\Application;
use Everest\Http\Middleware\Activity\AdminSubject;

Route::middleware([AdminSubject::class])->group(function () {
    Route::get('/permissions', Application\PermissionsController::class);

    Route::get('/overview', [Application\OverviewController::class, 'index']);
    Route::get('/queues', [Application\QueueHealthController::class, 'index']);
    Route::get('/queues/failed', [Application\QueueHealthController::class, 'failed']);
    Route::get('/queues/failed/{uuid}', [Application\QueueHealthController::class, 'show'])->whereUuid('uuid');
    Route::post('/queues/failed/{uuid}/retry', [Application\QueueHealthController::class, 'retry'])->whereUuid('uuid');
    Route::post('/queues/failed/retry', [Application\QueueHealthController::class, 'retryMany']);
    Route::post('/queues/failed/sweep-preview', [Application\QueueHealthController::class, 'sweepPreview']);
    Route::delete('/queues/failed/{uuid}', [Application\QueueHealthController::class, 'destroy'])->whereUuid('uuid');
    Route::delete('/queues/failed', [Application\QueueHealthController::class, 'destroyMany']);

    Route::get('/activity', Application\ActivityLogController::class);
    Route::get('/activity/users', [Application\ActivityLogController::class, 'users']);
    Route::get('/activity/events', [Application\ActivityLogController::class, 'events']);

    Route::group(['prefix' => '/setup'], function () {
        Route::get('/data', [Application\Setup\SetupController::class, 'data']);
        Route::post('/finish', [Application\Setup\SetupController::class, 'finish']);
    });

    /*
    |--------------------------------------------------------------------------
    | Settings Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/settings
    |
    */
    Route::group(['prefix' => '/settings'], function () {
        Route::patch('/', [Application\Settings\GeneralController::class, 'update']);
        Route::patch('/mode', [Application\Settings\ModeController::class, 'update']);
        Route::get('/features', [Application\Settings\FeaturesController::class, 'index']);
        Route::put('/features', [Application\Settings\FeaturesController::class, 'update']);
    });

    /*
    |--------------------------------------------------------------------------
    | Landing Page Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/landing
    |
    */
    Route::group(['prefix' => '/landing'], function () {
        Route::get('/', [Application\Landing\LandingController::class, 'index']);
        Route::patch('/', [Application\Landing\LandingController::class, 'update']);
    });

    /*
    |--------------------------------------------------------------------------
    | Auth Settings Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/auth
    |
    */
    Route::group(['prefix' => '/auth'], function () {
        Route::group(['prefix' => '/modules'], function () {
            Route::post('/enable', [Application\Auth\ModuleController::class, 'enable']);
            Route::post('/disable', [Application\Auth\ModuleController::class, 'disable']);

            Route::put('/', [Application\Auth\ModuleController::class, 'update']);
        });

        Route::group(['prefix' => '/jguard'], function () {
            Route::get('/pending', [Application\Auth\JGuardController::class, 'index']);
            Route::post('/approve/{userId}', [Application\Auth\JGuardController::class, 'approve']);
            Route::post('/reject/{userId}', [Application\Auth\JGuardController::class, 'reject']);
            Route::patch('/settings', [Application\Auth\JGuardController::class, 'settings']);
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Billing Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/billing
    |
    */
    Route::group(['prefix' => '/billing'], function () {
        Route::get('/analytics', [Application\Billing\BillingController::class, 'analytics']);
        Route::put('/settings', [Application\Billing\BillingController::class, 'settings']);

        Route::delete('/keys', [Application\Billing\BillingController::class, 'resetKeys']);

        // Storefront (/billing/order) customisation — section builder config.
        Route::group(['prefix' => '/store'], function () {
            Route::get('/', [Application\Billing\StoreController::class, 'index']);
            Route::patch('/', [Application\Billing\StoreController::class, 'update']);
        });

        Route::group(['prefix' => '/categories'], function () {
            Route::get('/', [Application\Billing\CategoryController::class, 'index']);
            Route::post('/', [Application\Billing\CategoryController::class, 'store']);

            Route::get('/{category:id}', [Application\Billing\CategoryController::class, 'view']);
            Route::patch('/{category:id}', [Application\Billing\CategoryController::class, 'update']);
            Route::delete('/{category:id}', [Application\Billing\CategoryController::class, 'delete']);

            Route::group(['prefix' => '/{category:id}/products'], function () {
                Route::get('/', [Application\Billing\ProductController::class, 'index']);
                Route::post('/', [Application\Billing\ProductController::class, 'store']);

                Route::get('/{product:id}', [Application\Billing\ProductController::class, 'view']);
                Route::patch('/{product:id}', [Application\Billing\ProductController::class, 'update']);
                Route::delete('/{product:id}', [Application\Billing\ProductController::class, 'delete']);

                // Billing cycle routes
                Route::group(['prefix' => '/{product:id}/billing-cycles'], function () {
                    Route::get('/', [Application\Billing\BillingCycleController::class, 'index']);
                    Route::post('/sync', [Application\Billing\BillingCycleController::class, 'sync']);
                    Route::delete('/{cycle:id}', [Application\Billing\BillingCycleController::class, 'delete']);
                });
            });
        });

        Route::group(['prefix' => '/orders'], function () {
            Route::get('/', [Application\Billing\OrderController::class, 'index']);
            Route::get('/{order:id}/threat', [Application\Billing\OrderController::class, 'threat']);
        });

        Route::group(['prefix' => '/custom-domains'], function () {
            Route::get('/', [Application\Billing\CustomDomainController::class, 'index']);
            Route::post('/', [Application\Billing\CustomDomainController::class, 'store']);
            Route::patch('/{customDomain:id}', [Application\Billing\CustomDomainController::class, 'update']);
            Route::delete('/{customDomain:id}', [Application\Billing\CustomDomainController::class, 'destroy']);
        });

        Route::group(['prefix' => '/coupons'], function () {
            Route::get('/', [Application\Billing\CouponController::class, 'index']);
            Route::post('/', [Application\Billing\CouponController::class, 'store']);

            Route::get('/{coupon:id}', [Application\Billing\CouponController::class, 'view']);
            Route::patch('/{coupon:id}', [Application\Billing\CouponController::class, 'update']);
            Route::delete('/{coupon:id}', [Application\Billing\CouponController::class, 'delete']);
        });

        Route::group(['prefix' => '/exceptions'], function () {
            Route::get('/', [Application\Billing\BillingExceptionController::class, 'index']);

            Route::delete('/', [Application\Billing\BillingExceptionController::class, 'resolveAll']);
            Route::delete('/{uuid}', [Application\Billing\BillingExceptionController::class, 'resolve']);
        });

        Route::prefix('/config')->group(function () {
            Route::post('/import', [Application\Billing\ConfigController::class, 'import']);
            Route::post('/export', [Application\Billing\ConfigController::class, 'export']);
        });

        // Invoice management
        Route::prefix('/invoices')->group(function () {
            Route::get('/', [Application\Billing\InvoiceController::class, 'index']);
            Route::get('/{uuid}', [Application\Billing\InvoiceController::class, 'show']);
            Route::get('/{uuid}/download', [Application\Billing\InvoiceController::class, 'download']);
            Route::get('/{uuid}/serve', [Application\Billing\InvoiceController::class, 'serve']);
            Route::post('/{uuid}/void', [Application\Billing\InvoiceController::class, 'void']);
            Route::post('/{uuid}/regenerate', [Application\Billing\InvoiceController::class, 'regenerate']);
            Route::post('/{uuid}/resend', [Application\Billing\InvoiceController::class, 'resend']);
        });

        // Invoice settings
        Route::prefix('/invoice-settings')->group(function () {
            Route::get('/', [Application\Billing\InvoiceSettingsController::class, 'show']);
            Route::put('/', [Application\Billing\InvoiceSettingsController::class, 'update']);
            Route::get('/storage-usage', [Application\Billing\InvoiceSettingsController::class, 'storageUsage']);
            Route::post('/test-connection', [Application\Billing\InvoiceSettingsController::class, 'testConnection']);
        });

        // Node pricing multiplier routes
        Route::prefix('/node-pricing')->group(function () {
            Route::get('/', [Application\Billing\NodePricingController::class, 'index']);
            Route::patch('/batch', [Application\Billing\NodePricingController::class, 'batchUpdate']);
            Route::post('/reset-all', [Application\Billing\NodePricingController::class, 'resetAll']);
            Route::patch('/{id}', [Application\Billing\NodePricingController::class, 'update']);
            Route::post('/{id}/reset', [Application\Billing\NodePricingController::class, 'reset']);
        });

        // Get suggested multiplier ranges
        Route::get('/multiplier-ranges', [Application\Billing\BillingCycleController::class, 'multiplierRanges']);
    });

    /*
    |--------------------------------------------------------------------------
    | Custom Domains Module Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/custom-domains
    |
    */
    Route::group(['prefix' => '/custom-domains'], function () {
        Route::get('/', [Application\Billing\CustomDomainController::class, 'index']);
        Route::post('/', [Application\Billing\CustomDomainController::class, 'store']);
        Route::patch('/{customDomain:id}', [Application\Billing\CustomDomainController::class, 'update']);
        Route::delete('/{customDomain:id}', [Application\Billing\CustomDomainController::class, 'destroy']);

        Route::get('/options', [Application\Billing\CustomDomainController::class, 'options']);
        Route::get('/api-keys', [Application\Billing\CustomDomainController::class, 'apiKeys']);
        Route::post('/api-keys', [Application\Billing\CustomDomainController::class, 'storeApiKey']);
        Route::patch('/api-keys/{apiKey:id}', [Application\Billing\CustomDomainController::class, 'updateApiKey']);
        Route::delete('/api-keys/{apiKey:id}', [Application\Billing\CustomDomainController::class, 'deleteApiKey']);

        Route::get('/settings', [Application\CustomDomains\SettingsController::class, 'index']);
        Route::put('/settings', [Application\CustomDomains\SettingsController::class, 'update']);
    });

    /*
    |--------------------------------------------------------------------------
    | AI Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/ai
    |
    */
    Route::group(['prefix' => '/ai'], function () {
        Route::get('/settings', [Application\IntelligenceController::class, 'index']);
        Route::put('/settings', [Application\IntelligenceController::class, 'update']);
        Route::get('/test', [Application\IntelligenceController::class, 'testConnection']);
        Route::post('/test-tools', [Application\IntelligenceController::class, 'probeToolCalling']);
        Route::get('/models', [Application\IntelligenceController::class, 'models']);
        Route::get('/stats', [Application\IntelligenceController::class, 'stats']);
        Route::get('/logs', [Application\IntelligenceController::class, 'recentLogs']);

        // The agent's tool policy and the live state of the inference backend.
        Route::get('/tools', [Application\AiAgentController::class, 'tools']);
        Route::put('/tools', [Application\AiAgentController::class, 'updateTools']);
        Route::get('/inference', [Application\AiAgentController::class, 'inference']);

        // The admin assistant. `decide` resolves an approval or a question the
        // turn suspended on — both arrive on a fresh request, because the stream
        // that asked closes when the turn suspends.
        Route::post('/agent', [Application\AiAgentController::class, 'start'])
            ->middleware('throttle:ai.agent');
        Route::post('/agent/decide', [Application\AiAgentController::class, 'decide']);
        Route::get('/agent/turns/{turnId}', [Application\AiAgentController::class, 'turnStatus']);
        // Stopping a turn and giving up a queue place are separate because the
        // two states are: a queued turn has a ticket and no turn id, and
        // nothing of it has run.
        Route::post('/agent/turns/{turnId}/cancel', [Application\AiAgentController::class, 'cancelTurn']);
        Route::delete('/agent/queue/{ticket}', [Application\AiAgentController::class, 'releaseQueue']);

        Route::prefix('/agent/conversations')->group(function () {
            Route::get('/', [Application\AiAgentController::class, 'conversations']);
            Route::get('/{conversationId}', [Application\AiAgentController::class, 'conversation']);
            Route::delete('/{conversationId}/assist', [Application\AiAgentController::class, 'endAssist']);
            Route::delete('/{conversationId}', [Application\AiAgentController::class, 'deleteConversation']);
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Plugins Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/plugins
    |
    */
    Route::group(['prefix' => '/plugins'], function () {
        Route::put('/settings', [Application\PluginsController::class, 'update']);
        Route::get('/analytics', [Application\PluginsController::class, 'analytics']);

        Route::get('/providers', [Application\PluginProviderRulesController::class, 'index']);
        Route::put('/providers', [Application\PluginProviderRulesController::class, 'update']);
    });

    // Legacy mods routes (backwards compatibility)
    Route::group(['prefix' => '/mods'], function () {
        Route::put('/settings', [Application\PluginsController::class, 'update']);
        Route::get('/analytics', [Application\PluginsController::class, 'analytics']);
    });

    /*
    |--------------------------------------------------------------------------
    | Webhook Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/webhooks
    |
    */
    Route::group(['prefix' => '/webhooks'], function () {
        Route::get('/', [Application\Webhooks\WebhookController::class, 'index']);
        Route::put('/', [Application\Webhooks\WebhookController::class, 'settings']);

        Route::post('/test', [Application\Webhooks\WebhookController::class, 'test']);
        Route::put('/toggle', [Application\Webhooks\WebhookController::class, 'toggle']);
    });

    /*
    |--------------------------------------------------------------------------
    | Email Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/email
    |
    */
    Route::group(['prefix' => '/email'], function () {
        Route::get('/settings', [Application\EmailController::class, 'getSettings']);
        Route::put('/settings', [Application\EmailController::class, 'updateSettings']);
        Route::get('/verification-rules', [Application\EmailController::class, 'getVerificationRules']);
        Route::put('/verification-rules', [Application\EmailController::class, 'updateVerificationRules']);
        Route::post('/test-smtp', [Application\EmailController::class, 'testSmtpConnection']);
        Route::post('/test-resend', [Application\EmailController::class, 'testResendConnection']);
        Route::post('/test', [Application\EmailController::class, 'sendTest']);

        // Email notification settings
        Route::get('/notifications', [Application\EmailController::class, 'getNotificationSettings']);
        Route::put('/notifications/{id}', [Application\EmailController::class, 'updateNotificationSetting']);

        // Email quota management
        Route::get('/quotas', [Application\EmailController::class, 'getQuotaInfo']);
        Route::get('/quotas/user/{userId}', [Application\EmailController::class, 'getUserQuota']);
        Route::put('/quotas/user/{userId}', [Application\EmailController::class, 'updateUserQuota']);

        // Email activity logs
        Route::get('/logs', [Application\EmailActivityController::class, 'index']);
        Route::get('/logs/templates', [Application\EmailActivityController::class, 'getTemplateKeys']);
        Route::get('/logs/{id}', [Application\EmailActivityController::class, 'show']);

        // Deferred email queue
        Route::get('/deferred', [Application\EmailActivityController::class, 'getDeferredQueue']);
        Route::post('/deferred/{id}/send-now', [Application\EmailActivityController::class, 'sendDeferredNow']);
        Route::delete('/deferred/{id}', [Application\EmailActivityController::class, 'cancelDeferred']);

        // Email template viewer/editor
        Route::get('/templates', [Application\EmailTemplateController::class, 'index']);
        Route::get('/templates/{key}/preview', [Application\EmailTemplateController::class, 'preview'])->where('key', '[a-z0-9_.]+');
        Route::get('/templates/{key}/source', [Application\EmailTemplateController::class, 'source'])->where('key', '[a-z0-9_.]+');
        Route::put('/templates/{key}/source', [Application\EmailTemplateController::class, 'update'])->where('key', '[a-z0-9_.]+');
        Route::delete('/templates/{key}/source', [Application\EmailTemplateController::class, 'revert'])->where('key', '[a-z0-9_.]+');
    });

    /*
    |--------------------------------------------------------------------------
    | API Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/api
    |
    */
    Route::group(['prefix' => '/api'], function () {
        Route::get('/', [Application\Api\ApiController::class, 'index']);
        Route::get('/access-profiles', [Application\Api\ApiController::class, 'accessProfiles']);
        Route::post('/', [Application\Api\ApiController::class, 'store']);
        Route::delete('/{key:id}', [Application\Api\ApiController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Tickets Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/tickets
    |
    */
    Route::group(['prefix' => '/tickets'], function () {
        Route::get('/', [Application\Tickets\TicketController::class, 'index']);
        Route::post('/', [Application\Tickets\TicketController::class, 'store']);
        Route::put('/settings', [Application\Tickets\TicketController::class, 'settings']);

        Route::get('/{ticket:id}', [Application\Tickets\TicketController::class, 'view']);
        Route::put('/{ticket:id}', [Application\Tickets\TicketController::class, 'update']);
        Route::delete('/{ticket:id}', [Application\Tickets\TicketController::class, 'delete']);

        Route::post('/message', [Application\Tickets\TicketMessageController::class, 'store']);
        Route::get('/{ticket:id}/messages', [Application\Tickets\TicketMessageController::class, 'index']);
    });

    /*
    |--------------------------------------------------------------------------
    | Extensions Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/extensions
    |
    */
    Route::group(['prefix' => '/extensions'], function () {
        Route::get('/', [Application\Extensions\ExtensionsController::class, 'index']);
        Route::get('/repositories', [Application\Extensions\ExtensionsController::class, 'repositories']);
        Route::get('/nests-eggs', [Application\Extensions\ExtensionsController::class, 'getNestsAndEggs']);
        Route::get('/progress', [Application\Extensions\ExtensionsController::class, 'progress']);
        Route::put('/settings', [Application\Extensions\ExtensionsController::class, 'settings']);
        Route::post('/refresh', [Application\Extensions\ExtensionsController::class, 'refresh']);
        Route::post('/repositories', [Application\Extensions\ExtensionsController::class, 'storeRepository']);
        Route::patch('/repositories/{repository:id}', [Application\Extensions\ExtensionsController::class, 'updateRepository']);
        Route::delete('/repositories/{repository:id}', [Application\Extensions\ExtensionsController::class, 'deleteRepository']);
        Route::post('/batch-install', [Application\Extensions\ExtensionsController::class, 'batchInstall']);
        Route::post('/batch-uninstall', [Application\Extensions\ExtensionsController::class, 'batchUninstall']);
        Route::post('/batch-update', [Application\Extensions\ExtensionsController::class, 'batchUpdate']);

        // Extension-contributed admin routes (routes/admin.php in each installed
        // package). The /ext/<id> prefix is derived from the package directory —
        // never from the file itself — so an extension cannot claim another's
        // namespace or escape its prefix, and the static /ext segment cannot
        // collide with the /{extensionId} wildcard below. Admin authentication
        // is inherited from the application-api stack wrapping this file; the
        // extensions.admin middleware adds a request-time defense-in-depth gate.
        //
        // Only enabled extensions are require()'d: a disabled extension's route
        // file — and therefore any top-level code in it — is never loaded, so
        // disabling an extension makes its code fully inert, not just 404'd.
        //
        // Every route the file registers is audited immediately afterwards
        // (ExtensionRouteGuardService): a route that strips its inherited
        // middleware or loses the extensions.admin gate is dropped to a 404.
        $enabledExtensionIds = Everest\Services\Extensions\ExtensionRuntimeGate::enabledExtensionIds();
        $extensionRouteGuard = app(Everest\Services\Extensions\ExtensionRouteGuardService::class);
        foreach ((glob(app_path('Extensions/Packages/*/routes/admin.php')) ?: []) as $extensionAdminRoutes) {
            $extensionRouteId = basename(dirname(dirname($extensionAdminRoutes)));
            if (!in_array($extensionRouteId, $enabledExtensionIds, true)) {
                continue;
            }

            $extensionRouteGuard->registerAndAudit(
                $extensionRouteId,
                ['extensions.admin:' . $extensionRouteId, 'throttle:api.ext-admin'],
                function () use ($extensionRouteId, $extensionAdminRoutes) {
                    Route::group([
                        'prefix' => '/ext/' . $extensionRouteId,
                        'middleware' => ['extensions.admin:' . $extensionRouteId, 'throttle:api.ext-admin'],
                    ], function () use ($extensionAdminRoutes) {
                        require $extensionAdminRoutes;
                    });
                }
            );
        }

        Route::get('/{extensionId}', [Application\Extensions\ExtensionsController::class, 'view']);
        Route::put('/{extensionId}', [Application\Extensions\ExtensionsController::class, 'update']);
        Route::post('/{extensionId}/database-plan', [Application\Extensions\ExtensionsController::class, 'databasePlan']);
        Route::post('/{extensionId}/toggle', [Application\Extensions\ExtensionsController::class, 'toggle']);
        Route::post('/{extensionId}/install', [Application\Extensions\ExtensionsController::class, 'install']);
        Route::post('/{extensionId}/update-package', [Application\Extensions\ExtensionsController::class, 'updatePackage']);
        Route::post('/{extensionId}/uninstall', [Application\Extensions\ExtensionsController::class, 'uninstall']);
    });

    /*
    |--------------------------------------------------------------------------
    | Alerts Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/alerts
    |
    */
    Route::group(['prefix' => '/alerts'], function () {
        Route::get('/', [Application\Alerts\AlertController::class, 'index']);
        Route::post('/', [Application\Alerts\AlertController::class, 'store']);
        Route::patch('/{alert:id}', [Application\Alerts\AlertController::class, 'updateAlert']);
        Route::delete('/{alert:id}', [Application\Alerts\AlertController::class, 'destroy']);

        // User search for alert targeting
        Route::get('/users/search', [Application\Alerts\AlertController::class, 'searchUsers']);
    });

    /*
    |--------------------------------------------------------------------------
    | Theme controller routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/theme
    |
    */
    Route::group(['prefix' => '/theme'], function () {
        Route::put('/colors', [Application\Theme\ThemeController::class, 'colors']);

        Route::post('/reset', [Application\Theme\ThemeController::class, 'reset']);

        Route::group(['prefix' => '/presets'], function () {
            Route::get('/', [Application\Theme\ThemePresetController::class, 'index']);
            Route::post('/', [Application\Theme\ThemePresetController::class, 'store']);
            Route::post('/{theme_preset:id}/apply', [Application\Theme\ThemePresetController::class, 'apply']);
            Route::delete('/{theme_preset:id}', [Application\Theme\ThemePresetController::class, 'delete']);
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Link controller routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/links
    |
    */
    Route::group(['prefix' => '/links'], function () {
        Route::get('/', [Application\Links\LinkController::class, 'index']);
        Route::post('/', [Application\Links\LinkController::class, 'store']);

        Route::patch('/{id}', [Application\Links\LinkController::class, 'update']);
        Route::delete('/{id}', [Application\Links\LinkController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Database Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/databases
    |
    */
    Route::group(['prefix' => '/databases'], function () {
        Route::get('/', [Application\Databases\DatabaseController::class, 'index']);
        Route::get('/{databaseHost:id}', [Application\Databases\DatabaseController::class, 'view']);

        Route::post('/', [Application\Databases\DatabaseController::class, 'store']);

        Route::patch('/{databaseHost:id}', [Application\Databases\DatabaseController::class, 'update']);

        Route::delete('/{databaseHost:id}', [Application\Databases\DatabaseController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Egg Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/eggs
    |
    */
    Route::group(['prefix' => '/eggs'], function () {
        Route::get('/{egg:id}', [Application\Eggs\EggController::class, 'view']);
        Route::get('/{egg:id}/export', [Application\Eggs\EggController::class, 'export']);

        Route::post('/', [Application\Eggs\EggController::class, 'store']);
        Route::post('/{egg:id}/variables', [Application\Eggs\EggVariableController::class, 'store']);

        Route::patch('/{egg:id}', [Application\Eggs\EggController::class, 'update']);
        Route::patch('/{egg:id}/variables', [Application\Eggs\EggVariableController::class, 'update']);

        Route::delete('/{egg:id}', [Application\Eggs\EggController::class, 'delete']);
        Route::delete('/{egg:id}/variables/{eggVariable:id}', [Application\Eggs\EggVariableController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Nest Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/nests
    |
    */
    Route::group(['prefix' => '/nests'], function () {
        Route::get('/', [Application\Nests\NestController::class, 'index']);
        Route::get('/{nest:id}', [Application\Nests\NestController::class, 'view']);
        Route::get('/{nest:id}/eggs', [Application\Eggs\EggController::class, 'index']);

        Route::post('/', [Application\Nests\NestController::class, 'store']);
        Route::post('/{nest:id}/import', [Application\Nests\NestController::class, 'import']);

        Route::patch('/{nest:id}', [Application\Nests\NestController::class, 'update']);

        Route::delete('/{nest:id}', [Application\Nests\NestController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Node Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/nodes
    |
    */
    Route::group(['prefix' => '/nodes'], function () {
        Route::get('/', [Application\Nodes\NodeController::class, 'index']);
        Route::get('/deployable', [Application\Nodes\NodeDeploymentController::class, '__invoke']);
        Route::get('/{node:id}', [Application\Nodes\NodeController::class, 'view']);
        Route::get('/{node:id}/configuration', [Application\Nodes\NodeConfigurationController::class, '__invoke']);
        Route::get('/{node:id}/information', [Application\Nodes\NodeInformationController::class, 'information']);
        Route::get('/{node:id}/utilization', [Application\Nodes\NodeInformationController::class, 'utilization']);

        Route::post('/', [Application\Nodes\NodeController::class, 'store']);

        Route::patch('/{node:id}', [Application\Nodes\NodeController::class, 'update']);

        Route::delete('/{node:id}', [Application\Nodes\NodeController::class, 'delete']);

        Route::group(['prefix' => '/{node:id}/allocations'], function () {
            Route::get('/', [Application\Nodes\AllocationController::class, 'index']);
            Route::post('/', [Application\Nodes\AllocationController::class, 'store']);
            Route::delete('/', [Application\Nodes\AllocationController::class, 'deleteAll']);
            Route::delete('/{allocation:id}', [Application\Nodes\AllocationController::class, 'delete']);
        });

        // Wings-RS (Supercharged) endpoints
        Route::group(['prefix' => '/{node:id}/wings-rs'], function () {
            Route::post('/detect', [Application\Nodes\NodeWingsRsController::class, 'detect']);
            Route::get('/overview', [Application\Nodes\NodeWingsRsController::class, 'overview']);
            Route::get('/stats', [Application\Nodes\NodeWingsRsController::class, 'stats']);
            Route::get('/logs', [Application\Nodes\NodeWingsRsController::class, 'logs']);
            Route::get('/logs/{file}', [Application\Nodes\NodeWingsRsController::class, 'logContents'])->where('file', '[a-zA-Z0-9._-]+');
            Route::post('/upgrade', [Application\Nodes\NodeWingsRsController::class, 'upgrade']);
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Server Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/servers
    |
    */
    Route::group(['prefix' => '/servers'], function () {
        Route::get('/', [Application\Servers\ServerController::class, 'index']);

        Route::group(['prefix' => '/presets'], function () {
            Route::get('/', [Application\Servers\ServerPresetController::class, 'index']);
            Route::post('/', [Application\Servers\ServerPresetController::class, 'store']);

            Route::get('/{server_preset:id}', [Application\Servers\ServerPresetController::class, 'view']);
            Route::patch('/{server_preset:id}', [Application\Servers\ServerPresetController::class, 'update']);
            Route::delete('/{server_preset:id}', [Application\Servers\ServerPresetController::class, 'delete']);
        });

        Route::get('/{server:id}', [Application\Servers\ServerController::class, 'view']);
        Route::get('/external/{external_id}', [Application\Servers\ExternalServerController::class, 'index']);

        Route::patch('/{server:id}', [Application\Servers\ServerController::class, 'update']);
        Route::patch('/{server:id}/startup', [Application\Servers\StartupController::class, 'index']);

        Route::post('/', [Application\Servers\ServerController::class, 'store']);
        Route::post('/preset', [Application\Servers\ServerController::class, 'storeWithPreset']);
        Route::post('/{server:id}/toggle', [Application\Servers\ServerManagementController::class, 'toggle']);
        Route::post('/{server:id}/suspend', [Application\Servers\ServerManagementController::class, 'suspend']);
        Route::post('/{server:id}/unsuspend', [Application\Servers\ServerManagementController::class, 'unsuspend']);
        Route::post('/{server:id}/reinstall', [Application\Servers\ServerManagementController::class, 'reinstall']);
        Route::post('/{server:id}/transfer', [Application\Servers\ServerManagementController::class, 'transfer']);

        Route::group(['prefix' => '/{server:id}/wings-rs'], function () {
            Route::get('/status', [Application\Servers\ServerWingsRsController::class, 'status']);
            Route::get('/stats', [Application\Servers\ServerWingsRsController::class, 'stats']);
            Route::get('/install-logs', [Application\Servers\ServerWingsRsController::class, 'installLogs']);
        });

        Route::post('/{server:id}/delete', [Application\Servers\ServerController::class, 'delete']);

        Route::group(['prefix' => '/{server:id}/databases'], function () {
            Route::get('/', [Application\Servers\DatabaseController::class, 'index']);
            Route::get('/{database:id}', [Application\Servers\DatabaseController::class, 'view']);

            Route::post('/', [Application\Servers\DatabaseController::class, 'store']);
            Route::post('/{database:id}/reset-password', [Application\Servers\DatabaseController::class, 'resetPassword']);

            Route::delete('/{database:id}', [Application\Servers\DatabaseController::class, 'delete']);
        });
    });

    /*
    |--------------------------------------------------------------------------
    | User Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/users
    |
    */
    Route::group(['prefix' => '/users'], function () {
        Route::get('/', [Application\Users\UserController::class, 'index']);
        Route::get('/{user:id}', [Application\Users\UserController::class, 'view']);
        Route::get('/external/{external_id}', [Application\Users\ExternalUserController::class, 'index']);

        Route::post('/', [Application\Users\UserController::class, 'store']);
        Route::post('/{user:id}/suspend', [Application\Users\UserController::class, 'suspend']);
        Route::post('/{user:id}/unsuspend', [Application\Users\UserController::class, 'unsuspend']);
        Route::post('/{user:id}/verify-email', [Application\Users\UserController::class, 'verifyEmail']);

        Route::patch('/{user:id}', [Application\Users\UserController::class, 'update']);

        Route::delete('/{user:id}', [Application\Users\UserController::class, 'delete']);
    });

    /*
    |--------------------------------------------------------------------------
    | Role Controller Routes
    |--------------------------------------------------------------------------
    |
    | Endpoint: /api/application/roles
    |
    */
    Route::group(['prefix' => '/roles'], function () {
        Route::get('/', [Application\Roles\RoleController::class, 'index']);
        Route::get('/permissions', [Application\Roles\RoleController::class, 'permissions']);
        Route::get('/{role:id}', [Application\Roles\RoleController::class, 'view']);

        Route::post('/', [Application\Roles\RoleController::class, 'store']);

        Route::patch('/{role:id}', [Application\Roles\RoleController::class, 'update']);
        Route::patch('/{role:id}/permissions', [Application\Roles\RoleController::class, 'updatePermissions']);

        Route::delete('/{role:id}', [Application\Roles\RoleController::class, 'delete']);
    });
});
