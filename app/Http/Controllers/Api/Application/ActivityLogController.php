<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\ActivityLog;
use Spatie\QueryBuilder\QueryBuilder;
use Spatie\QueryBuilder\AllowedFilter;
use Everest\Http\Requests\Api\Application\ActivityRequest;
use Everest\Transformers\Api\Application\ActivityLogTransformer;

class ActivityLogController extends ApplicationApiController
{
    /**
     * Returns a paginated set of administrative activity logs.
     */
    public function __invoke(ActivityRequest $request): array
    {
        $activityQuery = ActivityLog::query()->adminVisible();

        $activity = QueryBuilder::for($activityQuery)
            ->with('actor')
            ->allowedFilters(...[
                AllowedFilter::partial('event'),
                AllowedFilter::partial('ip'),
                AllowedFilter::partial('description'),
                AllowedFilter::callback('search', function ($query, $value) {
                    $query->where(function ($q) use ($value) {
                        $q->where('description', 'like', "%{$value}%")
                            ->orWhere('event', 'like', "%{$value}%")
                            ->orWhere('ip', 'like', "%{$value}%")
                            ->orWhereHas('actor', function ($actorQuery) use ($value) {
                                $actorQuery->where('username', 'like', "%{$value}%")
                                    ->orWhere('email', 'like', "%{$value}%");
                            });
                    });
                }),
                AllowedFilter::callback('actor', function ($query, $value) {
                    $query->whereHas('actor', function ($actorQuery) use ($value) {
                        $actorQuery->where('uuid', $value);
                    });
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
     * Returns all unique users who have activity logs.
     */
    public function users(ActivityRequest $request): array
    {
        $users = ActivityLog::query()
            ->adminVisible()
            ->whereNotNull('actor_id')
            ->join('users', 'activity_logs.actor_id', '=', 'users.id')
            ->select('users.uuid', 'users.username')
            ->distinct()
            ->orderBy('users.username')
            ->get()
            ->map(function ($user) {
                return [
                    'uuid' => $user->uuid,
                    'username' => $user->username,
                ];
            });

        return ['data' => $users];
    }

    /**
     * Returns all unique event types.
     */
    public function events(ActivityRequest $request): array
    {
        $events = ActivityLog::query()
            ->adminVisible()
            ->orderBy('event')
            ->distinct()
            ->pluck('event');

        return ['data' => $events];
    }
}
