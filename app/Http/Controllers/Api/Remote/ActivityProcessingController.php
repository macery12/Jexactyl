<?php

namespace Everest\Http\Controllers\Api\Remote;

use Carbon\Carbon;
use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Support\Str;
use Webmozart\Assert\Assert;
use Everest\Models\ActivityLog;
use Illuminate\Support\Facades\Log;
use Everest\Models\ActivityLogSubject;
use Everest\Http\Controllers\Controller;
use Everest\Services\Security\LogSanitizer;
use Everest\Http\Requests\Api\Remote\ActivityEventRequest;

class ActivityProcessingController extends Controller
{
    public function __invoke(ActivityEventRequest $request)
    {
        $tz = Carbon::now()->getTimezone();

        /** @var \Everest\Models\Node $node */
        $node = $request->attributes->get('node');

        $servers = $node->servers()->whereIn('uuid', $request->servers())->get()->keyBy('uuid');
        $users = User::query()->whereIn('uuid', $request->users())->get()->keyBy('uuid');

        $logs = [];
        foreach ($request->input('data') as $datum) {
            /** @var Server|null $server */
            $server = $servers->get($datum['server']);
            if (is_null($server) || !Str::startsWith($datum['event'], 'server:')) {
                continue;
            }

            try {
                $when = Carbon::createFromFormat(
                    \DateTimeInterface::RFC3339,
                    preg_replace('/(\.\d+)Z$/', 'Z', $datum['timestamp']),
                    'UTC'
                );
            } catch (\Exception $exception) {
                Log::warning($exception, ['timestamp' => $datum['timestamp']]);

                // If we cannot parse the value for some reason don't blow up this request, just go ahead
                // and log the event with the current time, and set the metadata value to have the original
                // timestamp that was provided.
                $when = Carbon::now();
                $datum['metadata'] = array_merge($datum['metadata'] ?? [], ['original_timestamp' => $datum['timestamp']]);
            }

            $properties = LogSanitizer::redactSensitivePayload($datum['metadata'] ?? []);
            if (!isset($properties['context'])) {
                $properties['context'] = 'client';
            }
            $properties['source'] = $properties['source'] ?? 'wings';

            $log = [
                'ip' => empty($datum['ip']) ? '127.0.0.1' : $datum['ip'],
                'event' => $datum['event'],
                'properties' => json_encode($properties),
                'scope' => 'server',
                'server_id' => $server->id,
                // We have to change the time to the current timezone due to the way Laravel is handling
                // the date casting internally. If we just leave it in UTC it ends up getting double-cast
                // and the time is way off.
                'timestamp' => $when->setTimezone($tz),
            ];

            if ($user = $users->get($datum['user'])) {
                $log['actor_id'] = $user->id;
                $log['actor_type'] = $user->getMorphClass();
            }

            if (!isset($logs[$datum['server']])) {
                $logs[$datum['server']] = [];
            }

            $logs[$datum['server']][] = $log;
        }

        foreach ($logs as $key => $data) {
            Assert::isInstanceOf($server = $servers->get($key), Server::class);

            $data = $this->coalesceSftpEvents($data);

            $batch = [];
            foreach ($data as $datum) {
                $id = ActivityLog::insertGetId($datum);
                $batch[] = [
                    'activity_log_id' => $id,
                    'subject_id' => $server->id,
                    'subject_type' => $server->getMorphClass(),
                ];
            }

            ActivityLogSubject::insert($batch);
        }
    }

    /**
     * Coalesce rapid SFTP create+write+rename sequences into single upload events.
     *
     * SFTP clients typically upload a file by: creating a temp file, writing to it,
     * then renaming it to the final name. This produces 3 activity log entries for
     * what the user perceives as a single upload.  We collapse these sequences into
     * a single "sftp.create" event carrying the final filename.
     */
    private function coalesceSftpEvents(array $events): array
    {
        // Group SFTP events by actor within a tight time window.
        // Rename events referencing a temp-created file absorb the create+write.
        $sftpCreate = [];
        $sftpWrite = [];
        $absorbed = [];

        foreach ($events as $idx => $event) {
            $e = $event['event'] ?? '';
            $actorId = $event['actor_id'] ?? null;

            $props = is_string($event['properties'] ?? null)
                ? json_decode($event['properties'], true)
                : ($event['properties'] ?? []);

            $files = $props['files'] ?? [];

            if ($e === 'server:sftp.create' && $actorId !== null) {
                foreach ((array) $files as $file) {
                    $name = is_array($file) ? ($file['to'] ?? $file[0] ?? '') : (string) $file;
                    if ($name !== '') {
                        $sftpCreate[$actorId . ':' . $name] = $idx;
                    }
                }
            }

            if ($e === 'server:sftp.write' && $actorId !== null) {
                foreach ((array) $files as $file) {
                    $name = is_array($file) ? ($file['to'] ?? $file[0] ?? '') : (string) $file;
                    if ($name !== '') {
                        $sftpWrite[$actorId . ':' . $name] = $idx;
                    }
                }
            }
        }

        // Now scan rename events: if a rename's "from" matches a created temp file,
        // rewrite the create event with the final name and drop the write + rename.
        foreach ($events as $idx => $event) {
            $e = $event['event'] ?? '';
            $actorId = $event['actor_id'] ?? null;

            if ($e !== 'server:sftp.rename' || $actorId === null) {
                continue;
            }

            $props = is_string($event['properties'] ?? null)
                ? json_decode($event['properties'], true)
                : ($event['properties'] ?? []);

            $files = $props['files'] ?? [];

            foreach ((array) $files as $file) {
                $from = is_array($file) ? ($file['from'] ?? '') : '';
                $to = is_array($file) ? ($file['to'] ?? '') : '';

                if ($from === '' || $to === '') {
                    continue;
                }

                $createKey = $actorId . ':' . $from;
                $writeKey = $actorId . ':' . $from;

                if (isset($sftpCreate[$createKey])) {
                    $createIdx = $sftpCreate[$createKey];

                    // Rewrite the create event to reference the final filename.
                    $createProps = is_string($events[$createIdx]['properties'] ?? null)
                        ? json_decode($events[$createIdx]['properties'], true)
                        : ($events[$createIdx]['properties'] ?? []);

                    $createProps['files'] = [$to];
                    $events[$createIdx]['properties'] = json_encode($createProps);

                    // Mark write and rename events for removal.
                    if (isset($sftpWrite[$writeKey])) {
                        $absorbed[$sftpWrite[$writeKey]] = true;
                    }
                    $absorbed[$idx] = true;
                }
            }
        }

        if (empty($absorbed)) {
            return $events;
        }

        return array_values(array_filter($events, fn ($_, $i) => !isset($absorbed[$i]), ARRAY_FILTER_USE_BOTH));
    }
}
