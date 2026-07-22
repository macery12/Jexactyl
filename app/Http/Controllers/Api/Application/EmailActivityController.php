<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Facades\Activity;
use Everest\Models\DeferredEmail;
use Everest\Models\EmailDelivery;
use Illuminate\Http\JsonResponse;
use Everest\Http\Requests\Api\Application\Email\GetDeferredQueueRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailActivityRequest;
use Everest\Http\Requests\Api\Application\Email\ViewEmailActivityRequest;
use Everest\Http\Requests\Api\Application\Email\ManageDeferredEmailRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailTemplateKeysRequest;

class EmailActivityController extends ApplicationApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Get email activity logs with pagination and filtering.
     */
    public function index(GetEmailActivityRequest $request): JsonResponse
    {
        $perPage = min((int) $request->input('per_page', 25), 100);

        $query = EmailDelivery::query()->with('user:id,email,username');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('template_key')) {
            $query->where('template_key', $request->input('template_key'));
        }

        if ($request->filled('recipient')) {
            $query->where('recipient', 'like', '%' . $request->input('recipient') . '%');
        }

        if ($request->filled('user_id')) {
            $query->where('user_id', $request->input('user_id'));
        }

        if ($request->boolean('only_failures')) {
            $query->where('status', EmailDelivery::STATUS_FAILED);
        }

        // Date range filter
        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', $request->input('date_from') . ' 00:00:00');
        }

        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', $request->input('date_to') . ' 23:59:59');
        }

        // Default date range: last 7 days
        if (!$request->filled('date_from') && !$request->filled('date_to')) {
            $query->where('created_at', '>=', now()->subDays(7));
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortDir = $request->input('sort_dir', 'desc');

        if (in_array($sortBy, ['created_at', 'status', 'template_key', 'recipient', 'sent_at'])) {
            $query->orderBy($sortBy, $sortDir === 'asc' ? 'asc' : 'desc');
        }

        $deliveries = $query->paginate($perPage);

        $transformed = $deliveries->toArray();
        $transformed['data'] = array_map(function ($delivery) {
            return $this->transformDeliveryToLegacyFormat($delivery);
        }, $transformed['data']);

        return response()->json($transformed);
    }

    /**
     * Get details of a specific email delivery.
     */
    public function show(ViewEmailActivityRequest $request, int $id): JsonResponse
    {
        $delivery = EmailDelivery::with([
            'user:id,email,username',
            'deliveryAttempts',
        ])->findOrFail($id);

        $log = $this->transformDeliveryToLegacyFormat($delivery->toArray());

        // Add attempt information
        $retryHistory = [];
        foreach ($delivery->deliveryAttempts as $attempt) {
            $retryHistory[] = [
                'attempt' => $attempt->attempt_number,
                'timestamp' => $attempt->started_at->toIso8601String(),
                'error' => $attempt->error,
                'status' => $attempt->status,
                'duration_ms' => $attempt->duration_ms,
            ];
        }

        return response()->json([
            'log' => $log,
            'sanitized_variables' => [], // Not stored in new structure
            'retry_history' => $retryHistory,
            'related_emails' => [], // Could be implemented later if needed
        ]);
    }

    /**
     * Get deferred email queue.
     */
    public function getDeferredQueue(GetDeferredQueueRequest $request): JsonResponse
    {
        $perPage = min((int) $request->input('per_page', 25), 100);

        $query = DeferredEmail::query()
            ->whereNull('sent_at')
            ->with('user:id,email,username');

        // Filter by due status
        if ($request->input('status') === 'due') {
            $query->where('scheduled_at', '<=', now());
        } elseif ($request->input('status') === 'pending') {
            $query->where('scheduled_at', '>', now());
        }

        $query->orderBy('scheduled_at');

        $deferred = $query->paginate($perPage);

        // Get stats
        $stats = [
            'total_queued' => DeferredEmail::whereNull('sent_at')->count(),
            'due_now' => DeferredEmail::whereNull('sent_at')->where('scheduled_at', '<=', now())->count(),
            'next_send_time' => DeferredEmail::whereNull('sent_at')
                ->where('scheduled_at', '>', now())
                ->min('scheduled_at'),
        ];

        return response()->json([
            'deferred' => $deferred,
            'stats' => $stats,
        ]);
    }

    /**
     * Send a deferred email immediately.
     */
    public function sendDeferredNow(ManageDeferredEmailRequest $request, int $id): JsonResponse
    {
        $deferred = DeferredEmail::findOrFail($id);

        if ($deferred->sent_at) {
            return response()->json([
                'success' => false,
                'error' => 'Email already sent',
            ], 400);
        }

        try {
            // Send the email using EmailManager
            // This would typically dispatch a job
            $deferred->scheduled_at = now(); // Move to front of queue
            $deferred->save();

            Activity::event('admin:email:deferred:send-now')
                ->property('deferred_id', $deferred->id)
                ->property('recipient', $deferred->recipient)
                ->property('template_key', $deferred->template_key)
                ->description("Manually triggered deferred email #{$deferred->id}")
                ->log();

            return response()->json([
                'success' => true,
                'message' => 'Email moved to front of queue and will be sent shortly.',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Cancel a deferred email.
     */
    public function cancelDeferred(ManageDeferredEmailRequest $request, int $id): JsonResponse
    {
        $deferred = DeferredEmail::findOrFail($id);

        if ($deferred->sent_at) {
            return response()->json([
                'success' => false,
                'error' => 'Email already sent, cannot cancel',
            ], 400);
        }

        $deferred->delete();

        Activity::event('admin:email:deferred:cancel')
            ->property('deferred_id', $id)
            ->property('recipient', $deferred->recipient)
            ->property('template_key', $deferred->template_key)
            ->description("Cancelled deferred email #{$id}")
            ->log();

        return response()->json([
            'success' => true,
            'message' => 'Deferred email cancelled',
        ]);
    }

    /**
     * Get all unique template keys for filtering.
     */
    public function getTemplateKeys(GetEmailTemplateKeysRequest $request): JsonResponse
    {
        $templateKeys = EmailDelivery::distinct()
            ->whereNotNull('template_key')
            ->pluck('template_key')
            ->sort()
            ->values();

        return response()->json(['template_keys' => $templateKeys]);
    }

    /**
     * Transform EmailDelivery into the admin email log payload.
     */
    private function transformDeliveryToLegacyFormat(array $delivery): array
    {
        return [
            'id' => $delivery['id'],
            'to' => $delivery['recipient'],
            'subject' => $delivery['subject'],
            'template_key' => $delivery['template_key'],
            'correlation_id' => $delivery['correlation_id'],
            'message_id' => $delivery['last_message_id'],
            'provider' => $delivery['provider'],
            'user_id' => $delivery['user_id'],
            'success' => $delivery['status'] === EmailDelivery::STATUS_SENT,
            'status' => $delivery['status'],
            'attempt_count' => $delivery['attempts'],
            'duration_ms' => null,
            'error' => $delivery['last_error'],
            'tags' => $delivery['tags'],
            'metadata' => null,
            'created_at' => $delivery['created_at'],
            'updated_at' => $delivery['updated_at'],
            'user' => $delivery['user'] ?? null,
        ];
    }
}
