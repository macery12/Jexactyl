import http from '@/lib/http';

// Admin webhooks client. Mirrors V1's api/routes/admin/webhooks.ts contract —
// the `/api/application/webhooks` endpoints already exist server-side
// (WebhookController: index / settings / toggle / test), this is a
// frontend-only port. Module enablement + endpoint URL live on the Everest
// bootstrap (`window.EverestConfiguration.webhooks`); the individual events are
// fetched here.

export interface WebhookEvent {
    id: number;
    key: string;
    description: string;
    enabled: boolean;
}

// Fractal collections arrive either as bare objects or wrapped in an
// `{ attributes }` envelope depending on serializer config — accept both.
function attrs(row: any): any {
    return row.attributes ?? row;
}

function toEvent(row: any): WebhookEvent {
    const a = attrs(row);
    return {
        id: a.id,
        key: a.key,
        description: a.description ?? '',
        enabled: Boolean(a.enabled),
    };
}

// GET the full catalogue of webhook events on the Panel.
export async function getWebhookEvents(): Promise<WebhookEvent[]> {
    const { data } = await http.get('/api/application/webhooks');
    return (data.data ?? []).map(toEvent);
}

// PUT a module setting (`enabled` | `url`). The backend persists it under
// `settings::modules:webhooks:<key>` and mirrors it onto the Everest bootstrap.
export async function updateWebhookSetting(key: 'enabled' | 'url', value: unknown): Promise<void> {
    await http.put('/api/application/webhooks', { key, value });
}

// Toggle a single event when `id` is given, or every event when it is omitted.
export async function toggleWebhookEvent(enabled: boolean, id?: number): Promise<void> {
    await http.put('/api/application/webhooks/toggle', { id, enabled });
}

// Fire a test event at the configured endpoint URL.
export async function sendTestWebhook(): Promise<void> {
    await http.post('/api/application/webhooks/test');
}

// Category is the second segment of the key, e.g. `admin:servers:create`.
export function eventCategory(key: string): string {
    return key.split(':')[1] ?? 'other';
}

// Human label for an event: drop the leading `admin:` namespace, then space out
// the remaining segments (mirrors V1's card title formatting).
export function eventLabel(key: string): string {
    return key
        .split(':')
        .slice(1)
        .join(' · ')
        .replace(/-/g, ' ');
}
