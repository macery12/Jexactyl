<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Everest\Models\MarketplaceInstallLog;
use Everest\Models\DownloadQueue;
use Everest\Services\Email\EmailRedactor;
use Everest\Services\Mods\ModrinthService;
use Everest\Http\Requests\Api\Application\Mods\GetModsAnalyticsRequest;
use Everest\Http\Requests\Api\Application\Mods\UpdateModsSettingsRequest;

class PluginsController extends ApplicationApiController
{
    public function __construct(
        private ModrinthService $modrinthService
    ) {
        parent::__construct();
    }

    public function update(UpdateModsSettingsRequest $request): Response
    {
        foreach ($request->normalize() as $key => $value) {
            // Never overwrite the stored CurseForge API key with an empty value —
            // the admin form omits/blanks it unless they are deliberately changing it.
            if ($key === 'curseforge_api_key' && ($value === null || $value === '')) {
                continue;
            }

            Setting::set('settings::modules:mods:' . $key, $value);
        }

        \Artisan::call('config:clear');

        $activitySettings = EmailRedactor::redactSensitivePayload(
            $request->all(),
            ['api_key', 'token', 'secret', 'password', 'authorization', 'key']
        );

        Activity::event('admin:plugins:update')
            ->property('settings', $activitySettings)
            ->description('Plugins module settings were updated')
            ->log();

        return $this->returnNoContent();
    }

    public function analytics(GetModsAnalyticsRequest $request): JsonResponse
    {
        $modrinthRateLimit = $this->modrinthService->getRateLimitUsage();

        $totalInstalls = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)->count();
        $totalFailures = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_FAILED)->count();
        $totalBandwidth = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)->sum('file_size_bytes');
        $bandwidth24h = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)
            ->where('created_at', '>=', now()->subHours(24))
            ->sum('file_size_bytes');

        $byProvider = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)
            ->select('provider', DB::raw('count(*) as count'))
            ->groupBy('provider')
            ->pluck('count', 'provider')
            ->toArray();

        $last24h = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)
            ->where('created_at', '>=', now()->subHours(24))
            ->select(DB::raw('DATE_FORMAT(created_at, "%Y-%m-%dT%H:00:00Z") as timestamp'), DB::raw('count(*) as installs'))
            ->groupBy('timestamp')
            ->orderBy('timestamp')
            ->get()
            ->toArray();

        $last7d = MarketplaceInstallLog::where('status', MarketplaceInstallLog::STATUS_SUCCESS)
            ->where('created_at', '>=', now()->subDays(7))
            ->select(DB::raw('DATE(created_at) as date'), DB::raw('count(*) as installs'))
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->toArray();

        $queuedNow      = DownloadQueue::where('status', DownloadQueue::STATUS_PENDING)->count();
        $downloadingNow = DownloadQueue::where('status', DownloadQueue::STATUS_DOWNLOADING)->count();
        $queueFailed    = DownloadQueue::where('status', DownloadQueue::STATUS_FAILED)
            ->where('created_at', '>=', now()->subDay())
            ->count();

        return response()->json([
            'totals' => [
                'installs' => $totalInstalls,
                'by_provider' => [
                    'modrinth' => $byProvider['modrinth'] ?? 0,
                    'spigot' => $byProvider['spigot'] ?? 0,
                    'curseforge' => $byProvider['curseforge'] ?? 0,
                ],
                'failures' => $totalFailures,
                'retries' => 0,
                'bandwidth_bytes' => (int) $totalBandwidth,
                'bandwidth_bytes_24h' => (int) $bandwidth24h,
            ],
            'queue' => [
                'pending'     => $queuedNow,
                'downloading' => $downloadingNow,
                'failed_24h'  => $queueFailed,
            ],
            'trends' => [
                'last_24h' => $last24h,
                'last_7d' => $last7d,
            ],
            'provider_health' => [
                'modrinth' => [
                    'enabled' => true,
                    'rate_limit' => $modrinthRateLimit,
                    'denied_by_policy' => 0,
                ],
                'spigot' => [
                    'enabled' => true,
                    'rate_limit' => null,
                    'denied_by_policy' => 0,
                ],
                'curseforge' => [
                    'enabled' => (bool) \Everest\Models\Setting::get('settings::modules:mods:curseforge_enabled', config('modules.mods.curseforge_enabled', false)),
                    'rate_limit' => null,
                    'denied_by_policy' => 0,
                ],
            ],
        ]);
    }
}
