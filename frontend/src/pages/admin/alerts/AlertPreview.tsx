import { CheckCircle2, Info, AlertTriangle, XCircle, X, ExternalLink } from 'lucide-react';
import { m, td } from '@/i18n';
import type { AlertType, AlertPosition } from '@/api/adminAlerts';

// Maps an alert type to a themed status token + icon. Uses status CSS vars only
// (no palette colours) so the preview tracks the active theme.
const TYPE_META: Record<AlertType, { token: string; Icon: typeof Info }> = {
    success: { token: 'var(--color-accent)', Icon: CheckCircle2 },
    info: { token: 'var(--brand)', Icon: Info },
    warning: { token: 'var(--color-warning)', Icon: AlertTriangle },
    danger: { token: 'var(--color-danger)', Icon: XCircle },
};

interface Props {
    type: AlertType;
    position: AlertPosition;
    title: string;
    content: string;
    dismissible: boolean;
    link: string;
    linkText: string;
}

// A themed alert card, coloured by type. Shared by every position variant.
function AlertCard({ type, title, content, dismissible, link, linkText }: Omit<Props, 'position'>) {
    const { token, Icon } = TYPE_META[type];
    return (
        <div
            className="relative flex items-start gap-3 border p-4 shadow-lg shadow-black/20"
            style={{
                borderRadius: 'var(--radius-card)',
                backgroundColor: 'var(--color-surface)',
                borderColor: token,
                borderLeftWidth: '3px',
            }}
        >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: token }} />
            <div className="min-w-0 flex-1">
                {title && (
                    <p className="mb-0.5 truncate text-sm font-semibold text-[var(--color-ink)]">{title}</p>
                )}
                <p className="text-sm text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                    {content || m['admin.alerts.preview.placeholder']()}
                </p>
                {link && (
                    <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {linkText || link}
                    </span>
                )}
            </div>
            {dismissible && (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            )}
        </div>
    );
}

// Renders the alert as it will appear to users, framed inside a mini "browser"
// so the chosen position (banner / slide-out / popup / notification) reads at a
// glance. Purely presentational — driven by the editor's live form state.
export default function AlertPreview(props: Props) {
    const { position } = props;

    const label = td(`admin.alerts.position.${position}`);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {m['admin.alerts.preview.title']()}
                </span>
                <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
            </div>

            <div
                className="relative h-56 overflow-hidden border border-[var(--color-border)] bg-[var(--color-canvas)]"
                style={{ borderRadius: 'var(--radius-card)' }}
            >
                {/* Faux window chrome */}
                <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-strong)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-strong)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-strong)]" />
                </div>

                {position === 'top-center' && (
                    <div className="absolute inset-x-0 top-9 px-4">
                        <AlertCard {...props} />
                    </div>
                )}

                {position === 'slide-out' && (
                    <div className="absolute bottom-4 right-4 w-64 max-w-[80%]">
                        <AlertCard {...props} />
                    </div>
                )}

                {position === 'center' && (
                    <div className="absolute inset-0 top-9 flex items-center justify-center bg-black/40 p-4">
                        <div className="w-64 max-w-full">
                            <AlertCard {...props} />
                        </div>
                    </div>
                )}

                {position === 'notification' && (
                    <div className="absolute right-4 top-12 w-64 max-w-[80%]">
                        <div className="mb-2 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                            {m['admin.alerts.preview.bell']()}
                        </div>
                        <AlertCard {...props} />
                    </div>
                )}
            </div>
        </div>
    );
}
