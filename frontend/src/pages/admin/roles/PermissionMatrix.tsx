import { useMemo, useState } from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { AdminPermissionGroups } from '@/api/adminRoles';

// The capability catalog is 96 permissions across 26 namespaces, and 21 of those
// namespaces are plain CRUD subsets. Rendering each permission as its own card
// row cost ~6,000px of scroll and left ragged gaps wherever two grid columns held
// cards of unequal height, so the editor draws the data as what it already is: a
// matrix of resources (rows) against actions (columns).
//
// Anything outside the four canonical actions — billing's nine extras, eggs'
// import/export, extensions' install/repositories, tickets' message, email's
// send — collapses into a per-row expander so the common shape stays narrow.

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

const ACTION_LABELS: Record<Action, () => string> = {
    read: m['admin.roles.action.read'],
    create: m['admin.roles.action.create'],
    update: m['admin.roles.action.update'],
    delete: m['admin.roles.action.delete'],
};

// Display grouping for the permission namespaces returned by the API. Any groups
// the API returns that aren't listed here are collected into a trailing "Other"
// section so nothing is ever hidden from operators.
const SECTIONS: { key: string; groups: string[] }[] = [
    { key: 'system', groups: ['overview', 'settings', 'activity'] },
    { key: 'access', groups: ['users', 'roles', 'api', 'auth'] },
    { key: 'infrastructure', groups: ['nodes', 'allocations', 'databases', 'server-databases'] },
    { key: 'servers', groups: ['servers', 'server-presets', 'nests', 'eggs'] },
    { key: 'communication', groups: ['tickets', 'email', 'webhooks', 'alerts'] },
    { key: 'content', groups: ['extensions', 'mods', 'ai'] },
    { key: 'billing', groups: ['billing'] },
    { key: 'customization', groups: ['theme', 'links', 'custom-domains'] },
];

// Paraglide resolves messages through static property access, so the label set is
// a literal map rather than a computed `m[...]` lookup.
const SECTION_LABELS: Record<string, () => string> = {
    system: m['admin.roles.section.system'],
    access: m['admin.roles.section.access'],
    infrastructure: m['admin.roles.section.infrastructure'],
    servers: m['admin.roles.section.servers'],
    communication: m['admin.roles.section.communication'],
    content: m['admin.roles.section.content'],
    billing: m['admin.roles.section.billing'],
    customization: m['admin.roles.section.customization'],
    other: m['admin.roles.section.other'],
};

const sectionLabel = (key: string) => (SECTION_LABELS[key] ?? m['admin.roles.section.other'])();

// Title-cases a dotted/kebab permission fragment for display (e.g. "server-presets"
// -> "Server Presets"). These are backend-provided identifiers, not UI copy.
const humanize = (s: string) =>
    s
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

interface ResolvedSection {
    key: string;
    groups: string[];
}

function buildSections(catalog: AdminPermissionGroups): ResolvedSection[] {
    const known = new Set(SECTIONS.flatMap(s => s.groups));
    const present = new Set(Object.keys(catalog));
    const sections: ResolvedSection[] = SECTIONS.map(s => ({
        key: s.key,
        groups: s.groups.filter(g => present.has(g)),
    })).filter(s => s.groups.length > 0);

    const leftover = Object.keys(catalog).filter(g => !known.has(g));
    if (leftover.length) sections.push({ key: 'other', groups: leftover });
    return sections;
}

/** Permission ids in a namespace, split into the canonical grid and the long tail. */
function splitGroup(groupKey: string, group: AdminPermissionGroups[string]) {
    const keys = Object.keys(group.keys);
    const canonical = new Map<Action, string>();
    const extras: string[] = [];
    for (const key of keys) {
        if ((ACTIONS as readonly string[]).includes(key)) canonical.set(key as Action, `${groupKey}.${key}`);
        else extras.push(key);
    }
    return { canonical, extras, all: keys.map(k => `${groupKey}.${k}`) };
}

function Checkbox({ checked, highlighted }: { checked: boolean; highlighted: boolean }) {
    return (
        <span
            className={cn(
                'flex h-[18px] w-[18px] items-center justify-center rounded border transition-colors',
                checked
                    ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]',
                highlighted && !checked && 'border-[var(--brand)]/60',
            )}
        >
            {checked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
    );
}

/** A grid cell: an interactive toggle, or a muted dash when the action does not exist. */
function ActionCell({
    id,
    description,
    checked,
    highlighted,
    readOnly,
    onToggle,
}: {
    id: string | undefined;
    description: string;
    checked: boolean;
    highlighted: boolean;
    readOnly: boolean;
    onToggle: (id: string) => void;
}) {
    if (!id) {
        return (
            <td className="px-2 py-1.5 text-center">
                <span aria-label={m['admin.roles.matrix.notAvailable']()} className="text-[var(--color-ink-faint)]/50">
                    <Minus className="mx-auto h-3 w-3" />
                </span>
            </td>
        );
    }

    return (
        <td className={cn('px-2 py-1.5 text-center', highlighted && 'bg-[var(--brand-soft)]/40')}>
            <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={`${id} — ${description}`}
                title={`${id}\n${description}`}
                disabled={readOnly}
                onClick={() => onToggle(id)}
                className="inline-flex items-center justify-center rounded p-1 transition-colors hover:bg-[var(--color-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Checkbox checked={checked} highlighted={highlighted} />
            </button>
        </td>
    );
}

/** The long-tail permissions for a namespace, revealed under its row. */
function ExtrasRow({
    groupKey,
    group,
    extras,
    selected,
    matches,
    readOnly,
    onToggle,
}: {
    groupKey: string;
    group: AdminPermissionGroups[string];
    extras: string[];
    selected: Set<string>;
    matches: Set<string> | null;
    readOnly: boolean;
    onToggle: (id: string) => void;
}) {
    return (
        <tr className="border-t border-[var(--color-border)]/60 bg-[var(--color-surface-2)]/30">
            <td colSpan={ACTIONS.length + 2} className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                    {extras.map(key => {
                        const id = `${groupKey}.${key}`;
                        const checked = selected.has(id);
                        const highlighted = matches?.has(id) ?? false;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                aria-label={`${id} — ${group.keys[key] ?? ''}`}
                                title={`${id}\n${group.keys[key] ?? ''}`}
                                disabled={readOnly}
                                onClick={() => onToggle(id)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 disabled:cursor-not-allowed disabled:opacity-50',
                                    checked
                                        ? 'border-[var(--brand)]/60 bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                        : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                                    highlighted && !checked && 'border-[var(--brand)]/50',
                                )}
                            >
                                <Checkbox checked={checked} highlighted={highlighted} />
                                {humanize(key)}
                            </button>
                        );
                    })}
                </div>
            </td>
        </tr>
    );
}

export interface PermissionMatrixProps {
    /** The complete capability catalog — drives which cells exist. */
    catalog: AdminPermissionGroups;
    selected: Set<string>;
    /** Permission ids matching the active search, or null when no search is active. */
    matches: Set<string> | null;
    readOnly: boolean;
    onToggle: (id: string) => void;
    onToggleAll: (ids: string[], select: boolean) => void;
}

export default function PermissionMatrix({
    catalog,
    selected,
    matches,
    readOnly,
    onToggle,
    onToggleAll,
}: PermissionMatrixProps) {
    const sections = useMemo(() => buildSections(catalog), [catalog]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // A search hides rows with no matching capability; the surviving cells are
    // tinted rather than removed so the rest of the namespace keeps its context.
    const visibleSections = useMemo(() => {
        if (!matches) return sections;
        return sections
            .map(section => ({
                ...section,
                groups: section.groups.filter(groupKey =>
                    Object.keys(catalog[groupKey]?.keys ?? {}).some(k => matches.has(`${groupKey}.${k}`)),
                ),
            }))
            .filter(section => section.groups.length > 0);
    }, [sections, matches, catalog]);

    if (visibleSections.length === 0) {
        return (
            <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
                {m['admin.roles.noPermissionMatches']()}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {visibleSections.map(section => {
                const rows = section.groups.flatMap(groupKey => {
                    const group = catalog[groupKey];
                    return group ? [{ groupKey, group, ...splitGroup(groupKey, group) }] : [];
                });
                const sectionIds = rows.flatMap(r => r.all);
                const sectionSelected = sectionIds.filter(id => selected.has(id)).length;
                const allSelected = sectionSelected === sectionIds.length;

                return (
                    <section
                        key={section.key}
                        className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]"
                    >
                        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                                {sectionLabel(section.key)}
                            </h3>
                            <div className="flex items-center gap-3">
                                <span className="text-xs tabular-nums text-[var(--color-ink-faint)]">
                                    {sectionSelected}/{sectionIds.length}
                                </span>
                                {!readOnly && (
                                    <button
                                        type="button"
                                        onClick={() => onToggleAll(sectionIds, !allSelected)}
                                        className="rounded-md px-2 py-0.5 text-[11px] font-medium text-[var(--brand)] transition-colors hover:bg-[var(--color-surface-2)]"
                                    >
                                        {allSelected ? m['admin.roles.deselectAll']() : m['admin.roles.selectAll']()}
                                    </button>
                                )}
                            </div>
                        </header>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[34rem] border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-border)]">
                                        <th scope="col" className="w-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                                            {m['admin.roles.matrix.resource']()}
                                        </th>
                                        {ACTIONS.map(action => {
                                            const columnIds = rows
                                                .map(r => r.canonical.get(action))
                                                .filter((id): id is string => Boolean(id));
                                            const columnAll =
                                                columnIds.length > 0 && columnIds.every(id => selected.has(id));
                                            return (
                                                <th
                                                    key={action}
                                                    scope="col"
                                                    className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]"
                                                >
                                                    <button
                                                        type="button"
                                                        disabled={readOnly || columnIds.length === 0}
                                                        onClick={() => onToggleAll(columnIds, !columnAll)}
                                                        title={m['admin.roles.matrix.toggleColumn']({
                                                            action: ACTION_LABELS[action](),
                                                        })}
                                                        className="rounded px-1.5 py-0.5 uppercase transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:hover:bg-transparent"
                                                    >
                                                        {ACTION_LABELS[action]()}
                                                    </button>
                                                </th>
                                            );
                                        })}
                                        <th scope="col" className="w-10 px-2 py-1.5">
                                            <span className="sr-only">{m['admin.roles.matrix.extrasHeader']()}</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ groupKey, group, canonical, extras, all }) => {
                                        const rowAll = all.every(id => selected.has(id));
                                        // A search hit inside the long tail forces the row open, so a
                                        // matched capability is never hidden behind the collapsed "+N".
                                        const isExpanded =
                                            expanded.has(groupKey)
                                            || extras.some(k => matches?.has(`${groupKey}.${k}`));
                                        return [
                                            <tr
                                                key={groupKey}
                                                className="border-t border-[var(--color-border)]/60 transition-colors hover:bg-[var(--color-surface-2)]/40"
                                            >
                                                <th scope="row" className="px-3 py-2 text-left font-normal">
                                                    <button
                                                        type="button"
                                                        disabled={readOnly}
                                                        onClick={() => onToggleAll(all, !rowAll)}
                                                        title={m['admin.roles.matrix.toggleRow']({
                                                            resource: humanize(groupKey),
                                                        })}
                                                        className="block max-w-full text-left disabled:cursor-default"
                                                    >
                                                        <span className="block truncate text-sm font-medium text-[var(--color-ink)]">
                                                            {humanize(groupKey)}
                                                        </span>
                                                        <span className="block truncate text-xs text-[var(--color-ink-faint)]">
                                                            {group.description}
                                                        </span>
                                                    </button>
                                                </th>
                                                {ACTIONS.map(action => {
                                                    const id = canonical.get(action);
                                                    return (
                                                        <ActionCell
                                                            key={action}
                                                            id={id}
                                                            description={(id && group.keys[action]) || ''}
                                                            checked={Boolean(id && selected.has(id))}
                                                            highlighted={Boolean(id && matches?.has(id))}
                                                            readOnly={readOnly}
                                                            onToggle={onToggle}
                                                        />
                                                    );
                                                })}
                                                <td className="px-2 py-2 text-right">
                                                    {extras.length > 0 && (
                                                        <button
                                                            type="button"
                                                            aria-expanded={isExpanded}
                                                            onClick={() =>
                                                                setExpanded(prev => {
                                                                    const next = new Set(prev);
                                                                    if (!next.delete(groupKey)) next.add(groupKey);
                                                                    return next;
                                                                })
                                                            }
                                                            className="inline-flex items-center gap-0.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                                                        >
                                                            +{extras.length}
                                                            <ChevronDown
                                                                className={cn(
                                                                    'h-3 w-3 transition-transform',
                                                                    isExpanded && 'rotate-180',
                                                                )}
                                                            />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>,
                                            extras.length > 0 && isExpanded ? (
                                                <ExtrasRow
                                                    key={`${groupKey}-extras`}
                                                    groupKey={groupKey}
                                                    group={group}
                                                    extras={extras}
                                                    selected={selected}
                                                    matches={matches}
                                                    readOnly={readOnly}
                                                    onToggle={onToggle}
                                                />
                                            ) : null,
                                        ];
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
