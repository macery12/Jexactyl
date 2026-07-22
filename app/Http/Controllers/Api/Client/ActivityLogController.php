<?php

namespace Everest\Http\Controllers\Api\Client;

use Everest\Models\Server;
use Everest\Models\ActivityLog;
use Spatie\QueryBuilder\QueryBuilder;
use Spatie\QueryBuilder\AllowedFilter;
use Illuminate\Database\Eloquent\Builder;
use Everest\Http\Requests\Api\Client\ClientApiRequest;
use Everest\Transformers\Api\Client\ActivityLogTransformer;

class ActivityLogController extends ClientApiController
{
    /**
     * Returns a paginated set of the user's activity logs, including
     * account-level events and activity from servers they own.
     */
    public function __invoke(ClientApiRequest $request): array
    {
        $user = $request->user();
        $ownedServerIds = Server::where('owner_id', $user->id)->pluck('id');

        $baseQuery = ActivityLog::query()
            ->whereNotIn('activity_logs.event', ActivityLog::DISABLED_EVENTS)
            ->where(function (Builder $query) use ($user, $ownedServerIds) {
                // Account-level activity by this user
                $query->where(function (Builder $account) use ($user) {
                    $account->where(function (Builder $scope) {
                        $scope->where('scope', 'account')
                            ->orWhere(function (Builder $s) {
                                $s->whereNull('scope')->whereNull('server_id');
                            });
                    })
                    ->where('actor_type', $user->getMorphClass())
                    ->where('actor_id', $user->id);
                });

                // Server-level activity on servers owned by this user
                if ($ownedServerIds->isNotEmpty()) {
                    $query->orWhere(function (Builder $server) use ($ownedServerIds) {
                        $server->where(function (Builder $scope) {
                            $scope->where('scope', 'server')
                                ->orWhere(function (Builder $s) {
                                    $s->whereNull('scope')->whereNotNull('server_id');
                                });
                        })
                        ->whereIn('server_id', $ownedServerIds);
                    });
                }
            });

        $activity = QueryBuilder::for($baseQuery)
            ->with('actor')
            ->allowedFilters(...[
                AllowedFilter::partial('event'),
                AllowedFilter::callback('scope', function (Builder $query, string $value) use ($user, $ownedServerIds) {
                    if ($value === 'account') {
                        $query->where(function (Builder $q) {
                            $q->where('scope', 'account')
                                ->orWhere(fn (Builder $s) => $s->whereNull('scope')->whereNull('server_id'));
                        })
                        ->where('actor_type', $user->getMorphClass())
                        ->where('actor_id', $user->id);
                    } elseif ($value === 'server') {
                        $query->where(function (Builder $q) {
                            $q->where('scope', 'server')
                                ->orWhere(fn (Builder $s) => $s->whereNull('scope')->whereNotNull('server_id'));
                        })
                        ->whereIn('server_id', $ownedServerIds);
                    }
                }),
                AllowedFilter::callback('server', function (Builder $query, string $value) use ($ownedServerIds) {
                    $serverId = Server::where('uuid', $value)
                        ->whereIn('id', $ownedServerIds)
                        ->value('id');

                    // Return no results if the requested server is not owned by this user
                    if (!$serverId) {
                        $query->whereRaw('1 = 0');

                        return;
                    }

                    $query->where('server_id', $serverId);
                }),
            ])
            ->allowedSorts(...['timestamp'])
            ->defaultSort('-timestamp')
            ->paginate(min($request->query('per_page', 25), 100))
            ->appends($request->query());

        return $this->fractal->collection($activity)
            ->transformWith(ActivityLogTransformer::class)
            ->toArray();
    }

    /**
     * Returns a list of servers owned by the authenticated user,
     * for use in the activity page server filter dropdown.
     */
    public function servers(ClientApiRequest $request): array
    {
        $servers = Server::where('owner_id', $request->user()->id)
            ->select('uuid', 'name')
            ->orderBy('name')
            ->get()
            ->map(fn (Server $server) => [
                'uuid' => $server->uuid,
                'name' => $server->name,
            ]);

        return ['data' => $servers];
    }
}
