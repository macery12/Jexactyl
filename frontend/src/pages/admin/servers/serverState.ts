import type { ServerState } from '@/api/adminServers';

// Single source of truth for how a server's lifecycle state is presented:
// a label, a status-color CSS var (for the web-view dots), and a Badge tone.
export const SERVER_STATE: Record<ServerState, { label: string; color: string; tone: 'accent' | 'warning' | 'danger' | 'muted' }> = {
    active: { label: 'Active', color: 'var(--color-accent)', tone: 'accent' },
    installing: { label: 'Installing', color: 'var(--color-warning)', tone: 'warning' },
    restoring: { label: 'Restoring', color: 'var(--color-warning)', tone: 'warning' },
    transferring: { label: 'Transferring', color: 'var(--color-warning)', tone: 'warning' },
    suspended: { label: 'Suspended', color: 'var(--color-danger)', tone: 'danger' },
    install_failed: { label: 'Install failed', color: 'var(--color-danger)', tone: 'danger' },
};
