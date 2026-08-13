import { useMemo } from 'react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';

// Line diff for the file-write approval card.
//
// Nobody can approve four kilobytes of TOML by eye, but everyone can read three
// changed lines — so the card shows the change, not the payload.

type Row = { type: 'same' | 'add' | 'remove'; text: string; oldNo: number | null; newNo: number | null };

/** Lines either side of a change kept for context; the rest is folded away. */
const CONTEXT = 3;

/**
 * Longest-common-subsequence diff, bounded.
 *
 * Identical prefixes and suffixes are stripped before the quadratic step, which
 * is what makes this affordable on a real config file: a three-line edit to a
 * 2000-line file leaves a handful of lines to actually compare.
 */
function diffLines(before: string[], after: string[]): Row[] {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;

    let end = 0;
    while (
        end < before.length - start &&
        end < after.length - start &&
        before[before.length - 1 - end] === after[after.length - 1 - end]
    ) {
        end++;
    }

    const head = before.slice(0, start).map<Row>((text, i) => ({ type: 'same', text, oldNo: i + 1, newNo: i + 1 }));
    const oldMid = before.slice(start, before.length - end);
    const newMid = after.slice(start, after.length - end);

    const rows: Row[] = [...head];
    let oldNo = start + 1;
    let newNo = start + 1;

    // Beyond this the DP table stops being worth building; the middle is
    // reported as a wholesale replacement instead.
    const BUDGET = 1500;

    const oldAt = (i: number) => oldMid[i] ?? '';
    const newAt = (j: number) => newMid[j] ?? '';

    if (oldMid.length > BUDGET || newMid.length > BUDGET) {
        for (const text of oldMid) rows.push({ type: 'remove', text, oldNo: oldNo++, newNo: null });
        for (const text of newMid) rows.push({ type: 'add', text, oldNo: null, newNo: newNo++ });
    } else {
        // table[i][j] = length of the LCS of oldMid[i:] and newMid[j:]. Flat
        // rows so the inner loop reads one array rather than two.
        const width = newMid.length + 1;
        const table = new Uint32Array((oldMid.length + 1) * width);

        for (let i = oldMid.length - 1; i >= 0; i--) {
            for (let j = newMid.length - 1; j >= 0; j--) {
                table[i * width + j] =
                    oldAt(i) === newAt(j)
                        ? (table[(i + 1) * width + (j + 1)] ?? 0) + 1
                        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + (j + 1)] ?? 0);
            }
        }

        let i = 0;
        let j = 0;
        while (i < oldMid.length && j < newMid.length) {
            if (oldAt(i) === newAt(j)) {
                rows.push({ type: 'same', text: oldAt(i), oldNo: oldNo++, newNo: newNo++ });
                i++;
                j++;
            } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)) {
                rows.push({ type: 'remove', text: oldAt(i), oldNo: oldNo++, newNo: null });
                i++;
            } else {
                rows.push({ type: 'add', text: newAt(j), oldNo: null, newNo: newNo++ });
                j++;
            }
        }
        while (i < oldMid.length) rows.push({ type: 'remove', text: oldAt(i++), oldNo: oldNo++, newNo: null });
        while (j < newMid.length) rows.push({ type: 'add', text: newAt(j++), oldNo: null, newNo: newNo++ });
    }

    for (let k = 0; k < end; k++) {
        rows.push({
            type: 'same',
            text: before[before.length - end + k] ?? '',
            oldNo: oldNo++,
            newNo: newNo++,
        });
    }

    return rows;
}

/** Drop runs of unchanged lines that are far from any edit. */
function fold(rows: Row[]): (Row | { type: 'gap'; count: number })[] {
    const keep = new Set<number>();

    rows.forEach((row, index) => {
        if (row.type === 'same') return;
        for (let i = index - CONTEXT; i <= index + CONTEXT; i++) keep.add(i);
    });

    const out: (Row | { type: 'gap'; count: number })[] = [];
    let skipped = 0;

    rows.forEach((row, index) => {
        if (keep.has(index)) {
            if (skipped > 0) {
                out.push({ type: 'gap', count: skipped });
                skipped = 0;
            }
            out.push(row);
        } else {
            skipped++;
        }
    });

    if (skipped > 0) out.push({ type: 'gap', count: skipped });

    return out;
}

export function DiffView({ original, updated }: { original: string; updated: string }) {
    const { rows, additions, deletions } = useMemo(() => {
        const before = original.split('\n');
        const after = updated.split('\n');
        const all = diffLines(before, after);

        return {
            rows: fold(all),
            additions: all.filter(r => r.type === 'add').length,
            deletions: all.filter(r => r.type === 'remove').length,
        };
    }, [original, updated]);

    return (
        <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs">
                <span className="font-medium text-[var(--color-accent)]">+{additions}</span>
                <span className="font-medium text-[var(--color-danger)]">−{deletions}</span>
                <span className="text-[var(--color-ink-faint)]">{m['server.ai.approval.diffLegend']()}</span>
            </div>

            <div className="max-h-72 overflow-auto">
                <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
                    <tbody>
                        {rows.map((row, index) =>
                            row.type === 'gap' ? (
                                <tr key={index}>
                                    <td
                                        colSpan={3}
                                        className="bg-[var(--color-surface-2)]/50 px-3 py-1 text-center text-[10px] text-[var(--color-ink-faint)]"
                                    >
                                        {m['server.ai.approval.diffFolded']({ count: row.count })}
                                    </td>
                                </tr>
                            ) : (
                                <tr
                                    key={index}
                                    className={cn(
                                        row.type === 'add' && 'bg-[var(--color-accent)]/10',
                                        row.type === 'remove' && 'bg-[var(--color-danger)]/10',
                                    )}
                                >
                                    <td className="w-10 select-none border-r border-[var(--color-border)] px-2 text-right align-top text-[var(--color-ink-faint)]">
                                        {row.oldNo ?? ''}
                                    </td>
                                    <td className="w-10 select-none border-r border-[var(--color-border)] px-2 text-right align-top text-[var(--color-ink-faint)]">
                                        {row.newNo ?? ''}
                                    </td>
                                    <td
                                        className={cn(
                                            'whitespace-pre-wrap break-all px-2 align-top',
                                            row.type === 'add' && 'text-[var(--color-accent)]',
                                            row.type === 'remove' && 'text-[var(--color-danger)]',
                                            row.type === 'same' && 'text-[var(--color-ink-muted)]',
                                        )}
                                    >
                                        <span className="select-none opacity-60">
                                            {row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}
                                        </span>{' '}
                                        {row.text || ' '}
                                    </td>
                                </tr>
                            ),
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
