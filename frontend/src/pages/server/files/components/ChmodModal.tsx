import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m, td } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { chmodFiles } from '@/api/files';

type Klass = 'owner' | 'group' | 'other';
type Bit = 'r' | 'w' | 'x';
const CLASSES: Klass[] = ['owner', 'group', 'other'];
const BITS: { bit: Bit; value: number }[] = [
    { bit: 'r', value: 4 },
    { bit: 'w', value: 2 },
    { bit: 'x', value: 1 },
];

// Parses an octal mode string (e.g. "755" or "0644") into a 3×3 permission grid.
// Returns null when the string isn't a clean octal triad so the matrix can grey
// out rather than guess.
function parseMode(mode: string): Record<Klass, number> | null {
    const digits = mode.replace(/^0+(?=\d)/, '').padStart(3, '0');
    if (!/^[0-7]{3}$/.test(digits)) return null;
    return {
        owner: Number(digits[0]),
        group: Number(digits[1]),
        other: Number(digits[2]),
    };
}

function gridToMode(grid: Record<Klass, number>): string {
    return `${grid.owner}${grid.group}${grid.other}`;
}

// chmod dialog with a live rwx matrix bound to an octal field — either can drive
// the other. Applies to one file, or a whole selection when `files.length > 1`
// (the matrix starts blank and only writes on submit, matching V1's behaviour).
export function ChmodModal({
    uuid,
    directory,
    files,
    initialMode,
    open,
    onClose,
    onDone,
}: {
    uuid: string;
    directory: string;
    files: string[];
    initialMode: string;
    open: boolean;
    onClose: () => void;
    onDone?: () => void;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const multi = files.length > 1;
    const [mode, setMode] = useState(multi ? '' : initialMode.replace(/^0+(?=\d)/, ''));

    const grid = useMemo(() => parseMode(mode), [mode]);

    const setBit = (klass: Klass, value: number) => {
        const base = grid ?? { owner: 0, group: 0, other: 0 };
        const next = { ...base, [klass]: base[klass] ^ value };
        setMode(gridToMode(next));
    };

    const mutation = useMutation({
        mutationFn: () => chmodFiles(uuid, directory, files.map(file => ({ file, mode: mode.trim() }))),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.chmod.saved']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
            onClose();
            onDone?.();
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const valid = /^[0-7]{3,4}$/.test(mode.trim());

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['server.files.chmod.title']()}
            description={multi ? m['server.files.chmod.multi']({ count: files.length }) : files[0]}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending || !valid}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.chmod.mode']()}
                    </label>
                    <Input
                        autoFocus
                        value={mode}
                        inputMode="numeric"
                        onChange={e => setMode(e.target.value.replace(/[^0-7]/g, '').slice(0, 4))}
                        placeholder="755"
                        className="w-28 font-mono"
                        invalid={mode.length > 0 && !valid}
                    />
                </div>

                <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                                <th className="px-3 py-2 text-left">{m['server.files.chmod.class']()}</th>
                                <th className="px-3 py-2">{m['server.files.chmod.read']()}</th>
                                <th className="px-3 py-2">{m['server.files.chmod.write']()}</th>
                                <th className="px-3 py-2">{m['server.files.chmod.execute']()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CLASSES.map(klass => (
                                <tr key={klass} className="border-b border-[var(--color-border)] last:border-0">
                                    <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                                        {td(`server.files.chmod.${klass}`)}
                                    </td>
                                    {BITS.map(({ bit, value }) => (
                                        <td key={bit} className="px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                className="accent-[var(--brand)]"
                                                disabled={!grid}
                                                checked={!!grid && (grid[klass] & value) === value}
                                                onChange={() => setBit(klass, value)}
                                                aria-label={`${klass} ${bit}`}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </Modal>
    );
}
