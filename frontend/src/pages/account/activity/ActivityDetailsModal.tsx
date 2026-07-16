import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import type { ActivityEntry } from '@/api/activity';

// Click-to-inspect JSON viewer for a single activity entry — restores the v1
// "metadata" dialog, re-skinned with V2 theme tokens. Shows the full raw event
// payload (event key, ip, timestamp + any properties the backend attached).
export function ActivityDetailsModal({ entry, onClose }: { entry: ActivityEntry | null; onClose: () => void }) {
    const payload = entry
        ? {
              event: entry.event,
              description: entry.description,
              ip: entry.ip,
              timestamp: entry.timestamp,
              ...(entry.properties ?? {}),
          }
        : {};

    return (
        <Modal open={!!entry} onClose={onClose} title={m['activity.details.title']()} description={entry?.event} size="md">
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-ink)]">
                {JSON.stringify(payload, null, 2)}
            </pre>
        </Modal>
    );
}

// Whether an entry carries anything worth opening the details modal for.
export function hasActivityDetails(entry: ActivityEntry): boolean {
    return entry.hasMetadata === true || (!!entry.properties && Object.keys(entry.properties).length > 0);
}
