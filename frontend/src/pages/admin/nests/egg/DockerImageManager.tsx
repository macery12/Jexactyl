import { Plus, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { DockerRow } from '@/api/adminNests';

// Compact editor for an egg's docker image → alias pairs. The egg editor owns
// the row state; this is a controlled table.
export function DockerImageManager({
    rows,
    onChange,
}: {
    rows: DockerRow[];
    onChange: (rows: DockerRow[]) => void;
}) {
    const setRow = (index: number, patch: Partial<DockerRow>) => {
        const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
        onChange(next);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/50 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                            <th className="px-3 py-2">{m['admin.nests.egg.docker.imageUrl']()}</th>
                            <th className="px-3 py-2">{m['admin.nests.egg.docker.label']()}</th>
                            <th className="w-14 px-3 py-2 text-center">{m['common.actions.delete']()}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={index} className="border-b border-[var(--color-border)] last:border-b-0">
                                <td className="px-3 py-2">
                                    <Input
                                        className="h-9"
                                        placeholder="ghcr.io/pterodactyl/yolks:java_17"
                                        value={row.image}
                                        onChange={e => setRow(index, { image: e.currentTarget.value })}
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <Input
                                        className="h-9"
                                        placeholder="java_17"
                                        value={row.alias}
                                        onChange={e => setRow(index, { alias: e.currentTarget.value })}
                                    />
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        disabled={rows.length < 2}
                                        aria-label={m['common.actions.delete']()}
                                        onClick={() => onChange(rows.filter((_, i) => i !== index))}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange([...rows, { image: '', alias: '' }])}
                >
                    <Plus className="h-4 w-4" /> {m['admin.nests.egg.docker.addImage']()}
                </Button>
                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.nests.egg.docker.hint']()}</p>
            </div>
        </div>
    );
}
