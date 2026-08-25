import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/cn';

// Simulated server cockpit for the landing hero: a console streaming log lines
// plus CPU / memory / player gauges that drift. Built from the same Panel
// language as the real server pages so the hero previews the actual product.
// Static (first lines + fixed gauges) under prefers-reduced-motion.

type Tone = 'plain' | 'ok' | 'player';

const SCRIPT: { text: () => string; tone: Tone }[] = [
    { text: () => m['landing.cockpit.log1'](), tone: 'plain' },
    { text: () => m['landing.cockpit.log2'](), tone: 'plain' },
    { text: () => m['landing.cockpit.log3'](), tone: 'plain' },
    { text: () => m['landing.cockpit.log4'](), tone: 'plain' },
    { text: () => m['landing.cockpit.log5'](), tone: 'ok' },
    { text: () => m['landing.cockpit.log6'](), tone: 'player' },
    { text: () => m['landing.cockpit.log7'](), tone: 'plain' },
    { text: () => m['landing.cockpit.log8'](), tone: 'ok' },
    { text: () => m['landing.cockpit.log9'](), tone: 'player' },
];

const TONE_CLASS: Record<Tone, string> = {
    plain: 'text-[var(--color-ink-muted)]',
    ok: 'text-[var(--color-accent)]',
    player: 'text-[var(--color-ink)]',
};

const VISIBLE_LINES = 7;

// Rolling fake clock so timestamps look alive without depending on real time.
function stamp(step: number): string {
    const total = 12 * 3600 + 4 * 60 + 1 + step * 13;
    const h = Math.floor(total / 3600) % 24;
    const mnt = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(mnt)}:${pad(s)}`;
}

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(
        () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

function Gauge({
    label,
    value,
    max,
    percent,
    tone = 'brand',
}: {
    label: string;
    value: string;
    max: string;
    percent: number;
    tone?: 'brand' | 'accent';
}) {
    return (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-3 pb-3 pt-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
                {label}
            </div>
            <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-[var(--color-ink)]">
                {value} <span className="text-[11px] font-normal text-[var(--color-ink-faint)]">/ {max}</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                    className={cn(
                        'h-full rounded-full transition-all duration-700',
                        tone === 'accent' ? 'bg-[var(--color-accent)]' : 'bg-[var(--brand)]',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                />
            </div>
        </div>
    );
}

export default function Cockpit() {
    const reduced = usePrefersReducedMotion();
    const [count, setCount] = useState(reduced ? 6 : 1);
    const [stats, setStats] = useState({ cpu: 42, mem: 3.2, players: 12 });
    const timer = useRef<number | undefined>(undefined);

    // Console: reveal the scripted lines one by one, then keep cycling.
    useEffect(() => {
        if (reduced) return;
        let step = count;
        const tick = () => {
            step += 1;
            setCount(step);
            timer.current = window.setTimeout(tick, step < 5 ? 700 : 1600 + Math.random() * 1400);
        };
        timer.current = window.setTimeout(tick, 700);
        return () => window.clearTimeout(timer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on motion-preference flips
    }, [reduced]);

    // Gauges: gentle drift.
    useEffect(() => {
        if (reduced) return;
        const id = window.setInterval(() => {
            setStats(prev => ({
                cpu: Math.max(18, Math.min(97, prev.cpu + (Math.random() - 0.5) * 14)),
                mem: Math.max(2.6, Math.min(6.9, prev.mem + (Math.random() - 0.5) * 0.4)),
                players:
                    Math.random() < 0.25
                        ? Math.max(8, Math.min(23, prev.players + (Math.random() < 0.5 ? -1 : 1)))
                        : prev.players,
            }));
        }, 1800);
        return () => window.clearInterval(id);
    }, [reduced]);

    const lines: { text: string; tone: Tone; step: number }[] = [];
    for (let i = Math.max(0, count - VISIBLE_LINES); i < count; i++) {
        const entry = SCRIPT[i % SCRIPT.length]!;
        lines.push({ text: entry.text(), tone: entry.tone, step: i });
    }

    return (
        <div aria-hidden className="flex min-w-0 select-none flex-col gap-2.5">
            <Panel title={m['landing.cockpit.title']()} icon={Terminal} flush right={<StateBadge />}>
                <div className="flex h-44 flex-col justify-end overflow-hidden px-3 py-2 font-mono text-[11.5px] leading-[1.8]">
                    {lines.map(line => (
                        <div key={line.step} className="truncate">
                            <span className="text-[var(--color-ink-faint)]">[{stamp(line.step)}]</span>{' '}
                            <span className="text-[var(--color-ink-faint)]">[Server thread/INFO]:</span>{' '}
                            <span className={TONE_CLASS[line.tone]}>{line.text}</span>
                        </div>
                    ))}
                    <div>
                        <span className="text-[var(--brand-bright)]">&gt;</span>{' '}
                        <span
                            className={cn(
                                'inline-block h-3 w-1.5 translate-y-0.5 bg-[var(--brand-bright)]',
                                !reduced && 'animate-pulse',
                            )}
                        />
                    </div>
                </div>
            </Panel>
            <div className="grid grid-cols-3 gap-2.5">
                <Gauge
                    label={m['landing.cockpit.cpu']()}
                    value={`${Math.round(stats.cpu)}%`}
                    max="400%"
                    percent={stats.cpu / 4}
                />
                <Gauge
                    label={m['landing.cockpit.memory']()}
                    value={stats.mem.toFixed(1)}
                    max="8 GB"
                    percent={(stats.mem / 8) * 100}
                />
                <Gauge
                    label={m['landing.cockpit.players']()}
                    value={String(stats.players)}
                    max="40"
                    percent={(stats.players / 40) * 100}
                    tone="accent"
                />
            </div>
        </div>
    );
}

function StateBadge() {
    return (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
            {m['common.states.running']()}
        </span>
    );
}
