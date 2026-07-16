import { m } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { getAlerts, type Alert } from '@/api/alerts';
import { cn } from '@/lib/cn';

const tone: Record<Alert['type'], { icon: typeof Info; cls: string }> = {
    success: { icon: CheckCircle2, cls: 'border-[var(--color-accent)]/30 text-[var(--color-accent)]' },
    info: { icon: Info, cls: 'border-[var(--brand)]/30 text-[var(--brand)]' },
    warning: { icon: AlertTriangle, cls: 'border-[var(--color-warning)]/30 text-[var(--color-warning)]' },
    danger: { icon: XCircle, cls: 'border-[var(--color-danger)]/30 text-[var(--color-danger)]' },
};

export function Announcements() {
    const { data: alerts } = useQuery({ queryKey: ['alerts'], queryFn: getAlerts });
    if (!alerts || alerts.length === 0) return null;

    return (
        <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-muted)]">
                <Megaphone className="h-4 w-4" /> {m['dashboard.announcements']()}
            </h2>
            {alerts.map(alert => {
                const tn = tone[alert.type];
                const Icon = tn.icon;
                return (
                    <div key={alert.id} className={cn('flex gap-3 rounded-xl border bg-[var(--color-surface)]/70 p-4', tn.cls)}>
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                            {alert.title && <p className="text-sm font-semibold text-[var(--color-ink)]">{alert.title}</p>}
                            <p className="text-sm text-[var(--color-ink-muted)]">{alert.content}</p>
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
