import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { m } from '@/i18n';
import { hostAddress, type DatabaseHost } from '@/api/adminDatabases';

type Probe = 'checking' | 'reachable' | 'unreachable';

// Best-effort reachability dot, mirroring V1's `DatabaseStatus`: fire a no-cors
// request at the host address and treat a resolved response as reachable. This
// is intentionally lightweight — the browser cannot speak the MySQL protocol, so
// an opaque success only tells us the address responded to a TCP/HTTP probe.
export default function HostStatus({ host }: { host: DatabaseHost }) {
    const [status, setStatus] = useState<Probe>('checking');

    useEffect(() => {
        let cancelled = false;
        setStatus('checking');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        fetch(`https://${hostAddress(host)}`, { mode: 'no-cors', signal: controller.signal })
            .then(() => !cancelled && setStatus('reachable'))
            .catch(() => !cancelled && setStatus('unreachable'))
            .finally(() => clearTimeout(timer));

        return () => {
            cancelled = true;
            controller.abort();
            clearTimeout(timer);
        };
    }, [host.host, host.port]);

    if (status === 'checking') {
        return <Spinner className="h-3 w-3 shrink-0" />;
    }

    const reachable = status === 'reachable';
    return (
        <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: reachable ? 'var(--color-accent)' : 'var(--color-danger)' }}
            title={reachable ? m['admin.databases.status.reachable']() : m['admin.databases.status.unreachable']()}
        />
    );
}
