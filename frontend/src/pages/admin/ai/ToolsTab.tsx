import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search, ShieldAlert, Terminal, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Panel } from '@/components/ui/Panel';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { getAiTools, updateAiTools, type AiRiskTier, type AiToolDefinition } from '@/api/adminAi';

// What the agent may call, and what it has to ask before doing.
//
// The tier is the whole safety model in one column: SAFE runs unattended, WRITE
// raises an approval card, DESTRUCTIVE demands the server's name typed out. An
// operator who trusts a tool can relax it here; one who does not can harden it
// or switch it off entirely.

const RISK_STYLES: Record<AiRiskTier, string> = {
    safe: 'text-[var(--color-accent)]',
    write: 'text-[var(--color-warning)]',
    destructive: 'text-[var(--color-danger)]',
};

function riskLabel(risk: AiRiskTier): string {
    return risk === 'safe'
        ? m['admin.ai.tools.riskSafe']()
        : risk === 'write'
          ? m['admin.ai.tools.riskWrite']()
          : m['admin.ai.tools.riskDestructive']();
}

export function ToolsTab() {
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);

    const { data, isLoading } = useQuery({ queryKey: ['admin', 'ai', 'tools'], queryFn: getAiTools });

    const [overrides, setOverrides] = useState<Record<string, AiRiskTier>>({});
    const [disabled, setDisabled] = useState<string[]>([]);
    const [commands, setCommands] = useState<string[]>([]);
    const [newCommand, setNewCommand] = useState('');
    const [search, setSearch] = useState('');
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!data) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: seeds editable form state from the loaded policy
        setOverrides(
            Object.fromEntries(
                data.data.filter(tool => tool.overridden).map(tool => [tool.name, tool.risk]),
            ) as Record<string, AiRiskTier>,
        );
        setDisabled(data.data.filter(tool => !tool.enabled).map(tool => tool.name));
        setCommands(data.console.extra);
        setDirty(false);
    }, [data]);

    const save = useMutation({
        mutationFn: () =>
            updateAiTools({ risk_overrides: overrides, disabled_tools: disabled, console_safe_commands: commands }),
        onSuccess: () => {
            push({ type: 'success', message: m['admin.ai.tools.saved']() });
            setDirty(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'tools'] });
        },
        onError: (error: unknown) => push({ type: 'error', message: firstError(error) ?? m['common.states.genericError']() }),
    });

    const groups = useMemo(() => {
        if (!data) return [];

        const term = search.trim().toLowerCase();
        const matching = term
            ? data.data.filter(
                  tool => tool.name.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term),
              )
            : data.data;

        const byGroup = new Map<string, AiToolDefinition[]>();
        for (const tool of matching) {
            const key = tool.group ?? '';
            byGroup.set(key, [...(byGroup.get(key) ?? []), tool]);
        }

        // The always-available base set first, then the opt-in groups.
        return [...byGroup.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    }, [data, search]);

    if (isLoading || !data) {
        return (
            <div className="flex items-center justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const setRisk = (tool: AiToolDefinition, risk: AiRiskTier) => {
        setDirty(true);
        setOverrides(current => {
            const next = { ...current };
            // Storing an override equal to the default would freeze the tool at
            // today's tier even if the panel later hardens it.
            if (risk === tool.default_risk) delete next[tool.name];
            else next[tool.name] = risk;
            return next;
        });
    };

    const toggleEnabled = (tool: AiToolDefinition, enabled: boolean) => {
        setDirty(true);
        setDisabled(current => (enabled ? current.filter(name => name !== tool.name) : [...current, tool.name]));
    };

    const addCommand = () => {
        const value = newCommand.trim().toLowerCase();
        if (!value || commands.includes(value) || data.console.defaults.includes(value)) {
            setNewCommand('');
            return;
        }
        setCommands(current => [...current, value]);
        setNewCommand('');
        setDirty(true);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[16rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={m['admin.ai.tools.search']()}
                        className="pl-9"
                    />
                </div>
                <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? <Spinner className="h-4 w-4" /> : m['common.actions.save']()}
                </Button>
            </div>

            {groups.map(([group, tools]) => (
                <Panel
                    key={group || 'base'}
                    title={group || m['admin.ai.tools.baseSet']()}
                    right={
                        <span className="text-[11px] normal-case tracking-normal text-[var(--color-ink-faint)]">
                            {group ? data.groups[group] : m['admin.ai.tools.baseSetHint']()}
                        </span>
                    }
                >
                    <div className="divide-y divide-[var(--color-border)]">
                        {tools.map(tool => {
                            const risk = overrides[tool.name] ?? tool.default_risk;
                            const enabled = !disabled.includes(tool.name);

                            return (
                                <div key={tool.name} className="flex items-center gap-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-medium text-[var(--color-ink)]">
                                                {tool.name}
                                            </span>
                                            {risk !== tool.default_risk && (
                                                <button
                                                    type="button"
                                                    onClick={() => setRisk(tool, tool.default_risk)}
                                                    title={m['admin.ai.tools.resetRisk']({
                                                        risk: riskLabel(tool.default_risk),
                                                    })}
                                                    className="flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                                                >
                                                    <RotateCcw className="h-2.5 w-2.5" />
                                                    {m['admin.ai.tools.changed']()}
                                                </button>
                                            )}
                                        </div>
                                        <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-ink-faint)]">
                                            {tool.description}
                                        </p>
                                    </div>

                                    <Select
                                        value={risk}
                                        disabled={!enabled}
                                        onChange={value => setRisk(tool, value as AiRiskTier)}
                                        options={data.risks.map(option => ({
                                            value: option,
                                            label: riskLabel(option),
                                        }))}
                                        className={cn('h-9 w-40', RISK_STYLES[risk])}
                                    />

                                    <Switch
                                        checked={enabled}
                                        onChange={next => toggleEnabled(tool, next)}
                                        label={tool.name}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </Panel>
            ))}

            <Panel title={m['admin.ai.tools.consoleTitle']()} icon={Terminal}>
                <div className="space-y-3">
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.tools.consoleHint']()}</p>

                    <div className="flex gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                        <p className="text-xs text-[var(--color-ink-muted)]">
                            {m['admin.ai.tools.consoleWarning']()}
                        </p>
                    </div>

                    <div>
                        <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['admin.ai.tools.consoleBuiltIn']()}
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {data.console.defaults.map(command => (
                                <span
                                    key={command}
                                    className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink-faint)]"
                                >
                                    {command}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['admin.ai.tools.consoleExtra']()}
                        </p>
                        <div className="mb-2 flex flex-wrap gap-1">
                            {commands.length === 0 && (
                                <span className="text-xs text-[var(--color-ink-faint)]">
                                    {m['admin.ai.tools.consoleNone']()}
                                </span>
                            )}
                            {commands.map(command => (
                                <span
                                    key={command}
                                    className="flex items-center gap-1 rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink)]"
                                >
                                    {command}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCommands(c => c.filter(x => x !== command));
                                            setDirty(true);
                                        }}
                                        className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)]"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <Input
                                value={newCommand}
                                onChange={e => setNewCommand(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addCommand();
                                    }
                                }}
                                placeholder={m['admin.ai.tools.consolePlaceholder']()}
                                className="h-9 font-mono text-xs"
                            />
                            <Button size="sm" variant="outline" onClick={addCommand}>
                                <Plus className="h-3.5 w-3.5" />
                                {m['common.actions.create']()}
                            </Button>
                        </div>
                    </div>
                </div>
            </Panel>
        </div>
    );
}
