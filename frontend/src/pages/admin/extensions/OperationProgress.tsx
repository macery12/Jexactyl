import { m, td } from '@/i18n';
import { Check, Loader2 } from 'lucide-react';
import type { OperationProgress as Progress } from '@/api/extensions';

// Stage orders mirror ExtensionInstallProgressService (app/Services/Extensions).
const INSTALL = ['downloading', 'extracting', 'validating', 'copying', 'optimizing', 'building', 'registering', 'completed'];
const UNINSTALL = ['validating', 'removing', 'optimizing', 'building', 'registering', 'completed'];
const UPDATE = ['downloading', 'extracting', 'validating', 'removing', 'copying', 'optimizing', 'building', 'registering', 'completed'];

function stagesFor(action: string): string[] {
    if (action.includes('uninstall')) return UNINSTALL;
    if (action.includes('update')) return UPDATE;
    return INSTALL;
}

function actionKey(action: string): 'progress.install' | 'progress.uninstall' | 'progress.update' {
    if (action.includes('uninstall')) return 'progress.uninstall';
    if (action.includes('update')) return 'progress.update';
    return 'progress.install';
}

// A fixed banner shown while a server-side install/uninstall/update runs. The
// page polls /extensions/progress and feeds the payload here; buttons elsewhere
// are locked for the duration.
export function OperationProgressBanner({ progress }: { progress: Progress }) {
    const stages = stagesFor(progress.action);
    const current = Math.max(0, stages.indexOf(progress.stage));
    const pct = Math.round((current / (stages.length - 1)) * 100);

    return (
        <div
            style={{ borderRadius: 'var(--radius-card)' }}
            className="sticky top-2 z-30 border border-[var(--brand)]/30 bg-[var(--color-surface)]/95 p-4 shadow-lg shadow-black/20 backdrop-blur"
        >
            <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
                <span className="text-sm font-medium text-[var(--color-ink)]">
                    {td(`extensions.${actionKey(progress.action)}`)}{' '}
                    <span className="font-mono text-[var(--color-ink-muted)]">{progress.extension_id}</span>
                </span>
                {progress.batch_total != null && (
                    <span className="ml-auto font-mono text-xs text-[var(--color-ink-faint)]">
                        {m['extensions.progress.batch']({ current: progress.batch_current ?? 1, total: progress.batch_total })}
                    </span>
                )}
            </div>

            {/* progress rail */}
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                    className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>

            {/* stage chips */}
            <div className="mt-3 flex flex-wrap gap-1.5">
                {stages.map((stage, i) => {
                    const done = i < current;
                    const active = i === current;
                    return (
                        <span
                            key={stage}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide"
                            style={{
                                background: active
                                    ? 'color-mix(in srgb, var(--brand) 14%, transparent)'
                                    : 'var(--color-surface-2)',
                                color: active
                                    ? 'var(--brand)'
                                    : done
                                      ? 'var(--color-ink-muted)'
                                      : 'var(--color-ink-faint)',
                            }}
                        >
                            {done && <Check className="h-3 w-3" />}
                            {active && <Loader2 className="h-3 w-3 animate-spin" />}
                            {td(`extensions.progress.stages.${stage}`)}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
