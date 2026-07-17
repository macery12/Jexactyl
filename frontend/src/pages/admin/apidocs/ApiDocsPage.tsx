import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, ExternalLink, Search, Check, Copy, Lock, ChevronRight } from 'lucide-react';
import { m, td } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useWideContent } from '@/components/shell/shellLayout';
import { getApiSpec, OPENAPI_DOCS_URL } from '@/api/apiDocs';
import {
    parseEndpoints,
    flattenProperties,
    jsonMedia,
    buildCurl,
    serverUrl,
    displayPath,
    typeLabel,
    sortedResponseCodes,
    resolveSchema,
    METHOD_ORDER,
    type Endpoint,
    type EndpointGroup,
    type HttpMethod,
    type OpenApiDoc,
    type OpenApiMediaType,
    type OpenApiParameter,
    type PropertyRow,
} from './openapi';

const GROUP_ORDER: EndpointGroup[] = ['client', 'application', 'other'];

const GROUP_META: Record<EndpointGroup, { labelKey: string }> = {
    client: { labelKey: 'admin.apiDocs.group.client' },
    application: { labelKey: 'admin.apiDocs.group.application' },
    other: { labelKey: 'admin.apiDocs.group.other' },
};

const METHOD_TONE: Record<HttpMethod, string> = {
    get: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
    post: 'border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand)]',
    put: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    patch: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    delete: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    head: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
    options: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
};

function MethodBadge({ method, className }: { method: HttpMethod; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
                METHOD_TONE[method],
                className,
            )}
        >
            {method}
        </span>
    );
}

export default function ApiDocsPage() {
    const push = useFlashes(s => s.push);
    const queryClient = useQueryClient();
    useWideContent();

    const [search, setSearch] = useState('');
    const [methodFilter, setMethodFilter] = useState<Set<HttpMethod>>(new Set());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [regenerating, setRegenerating] = useState(false);

    const { data: doc, isLoading, isError, error } = useQuery({
        queryKey: ['admin', 'api-docs', 'spec'],
        queryFn: () => getApiSpec(false),
        staleTime: 5 * 60 * 1000,
    });

    const endpoints = useMemo(() => parseEndpoints(doc), [doc]);

    // Which HTTP methods actually appear — only show filter chips for those.
    const availableMethods = useMemo(() => {
        const present = new Set(endpoints.map(e => e.method));
        return METHOD_ORDER.filter(m => present.has(m));
    }, [endpoints]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return endpoints.filter(e => {
            if (methodFilter.size && !methodFilter.has(e.method)) return false;
            if (!q) return true;
            return (
                e.path.toLowerCase().includes(q) ||
                e.summary.toLowerCase().includes(q) ||
                e.tag.toLowerCase().includes(q)
            );
        });
    }, [endpoints, search, methodFilter]);

    // Nested nav model: group → tag → endpoints, all deterministically ordered.
    const groups = useMemo(() => groupEndpoints(filtered), [filtered]);

    const selected = useMemo(() => filtered.find(e => e.id === selectedId) ?? null, [filtered, selectedId]);

    // Keep a valid selection: pick the first visible endpoint whenever the
    // current one drops out of the filtered set.
    useEffect(() => {
        const first = filtered[0];
        if (first && !filtered.some(e => e.id === selectedId)) setSelectedId(first.id);
    }, [filtered, selectedId]);

    const toggleMethod = (method: HttpMethod) =>
        setMethodFilter(prev => {
            const next = new Set(prev);
            if (next.has(method)) next.delete(method);
            else next.add(method);
            return next;
        });

    const handleRegenerate = async () => {
        if (regenerating) return;
        setRegenerating(true);
        try {
            const fresh = await getApiSpec(true);
            queryClient.setQueryData(['admin', 'api-docs', 'spec'], fresh);
            push({ type: 'success', message: m['admin.apiDocs.regenerated']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['admin.apiDocs.regenerateError']() });
        } finally {
            setRegenerating(false);
        }
    };

    const handleDownload = () => {
        if (!doc) return;
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'openapi.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Header + detail pane render at 110%, the left rail at 125% — the
                page reads a touch small otherwise, and the dense rail worst of
                all. `zoom` enlarges + reflows within each area (no page-wide
                horizontal scroll); the rail track is widened to match its zoom. */}
            <header className="flex flex-wrap items-start justify-between gap-3" style={{ zoom: 1.1 } as React.CSSProperties}>
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.apiDocs.title']()}
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
                        {m['admin.apiDocs.subtitle']()}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleDownload} disabled={!doc}>
                        <Download className="h-4 w-4" />
                        {m['admin.apiDocs.download']()}
                    </Button>
                    <a
                        href={OPENAPI_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-3 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                    >
                        <ExternalLink className="h-4 w-4" />
                        {m['admin.apiDocs.openRaw']()}
                    </a>
                    <Button size="sm" onClick={handleRegenerate} disabled={regenerating}>
                        {regenerating ? (
                            <Spinner className="h-4 w-4" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                        {regenerating ? m['admin.apiDocs.regenerating']() : m['admin.apiDocs.regenerate']()}
                    </Button>
                </div>
            </header>

            {isLoading ? (
                <div className="flex items-center justify-center py-24">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : isError ? (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-6 text-sm text-[var(--color-danger)]">
                    {firstError(error) ?? m['admin.apiDocs.loadError']()}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
                    {/* Left rail: search + method filter + grouped endpoint nav. */}
                    <aside
                        className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start"
                        style={{ zoom: 1.25 } as React.CSSProperties}
                    >
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={m['admin.apiDocs.search']()}
                                className="h-10 pl-9"
                            />
                        </div>

                        {availableMethods.length > 1 && (
                            <div className="flex flex-wrap gap-1.5">
                                {availableMethods.map(method => {
                                    const active = methodFilter.has(method);
                                    return (
                                        <button
                                            key={method}
                                            type="button"
                                            onClick={() => toggleMethod(method)}
                                            className={cn(
                                                'rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors',
                                                active
                                                    ? METHOD_TONE[method]
                                                    : 'border-[var(--color-border)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                                            )}
                                        >
                                            {method}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <p className="px-1 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.apiDocs.endpointCount']({ count: filtered.length })}
                        </p>

                        <nav className="max-h-[62vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-2">
                            {groups.length === 0 ? (
                                <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-faint)]">
                                    {m['admin.apiDocs.empty']()}
                                </p>
                            ) : (
                                groups.map(group => (
                                    <NavGroup
                                        key={group.group}
                                        group={group}
                                        selectedId={selectedId}
                                        onSelect={setSelectedId}
                                    />
                                ))
                            )}
                        </nav>
                    </aside>

                    {/* Detail pane. */}
                    <section className="min-w-0" style={{ zoom: 1.1 } as React.CSSProperties}>
                        {selected ? (
                            <EndpointDetail doc={doc!} endpoint={selected} />
                        ) : (
                            <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink-faint)]">
                                {m['admin.apiDocs.emptySelection']()}
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

interface TagGroup {
    tag: string;
    endpoints: Endpoint[];
}
interface NavGroupModel {
    group: EndpointGroup;
    count: number;
    tags: TagGroup[];
}

function groupEndpoints(endpoints: Endpoint[]): NavGroupModel[] {
    const byGroup = new Map<EndpointGroup, Map<string, Endpoint[]>>();
    for (const e of endpoints) {
        let tags = byGroup.get(e.group);
        if (!tags) byGroup.set(e.group, (tags = new Map()));
        const list = tags.get(e.tag);
        if (list) list.push(e);
        else tags.set(e.tag, [e]);
    }
    const methodRank = (m: HttpMethod) => METHOD_ORDER.indexOf(m);
    return GROUP_ORDER.filter(g => byGroup.has(g)).map(group => {
        const tags = byGroup.get(group)!;
        let count = 0;
        const tagGroups: TagGroup[] = [...tags.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([tag, eps]) => {
                count += eps.length;
                eps.sort((a, b) => a.path.localeCompare(b.path) || methodRank(a.method) - methodRank(b.method));
                return { tag, endpoints: eps };
            });
        return { group, count, tags: tagGroups };
    });
}

function NavGroup({
    group,
    selectedId,
    onSelect,
}: {
    group: NavGroupModel;
    selectedId: string | null;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="mb-1">
            <div className="px-2 pb-1 pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]">
                    {td(GROUP_META[group.group].labelKey)}
                </span>
                <span className="ml-2 text-[10px] text-[var(--color-ink-faint)]">{group.count}</span>
            </div>
            {group.tags.map(tag => (
                <NavTag key={tag.tag} tag={tag} selectedId={selectedId} onSelect={onSelect} />
            ))}
        </div>
    );
}

function NavTag({
    tag,
    selectedId,
    onSelect,
}: {
    tag: TagGroup;
    selectedId: string | null;
    onSelect: (id: string) => void;
}) {
    const containsSelected = tag.endpoints.some(e => e.id === selectedId);
    const [open, setOpen] = useState(true);

    // Keep the group holding the selected endpoint expanded.
    useEffect(() => {
        if (containsSelected) setOpen(true);
    }, [containsSelected]);

    return (
        <div className="mb-0.5">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1 rounded-lg px-2 py-1 text-left text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
            >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
                <span className="truncate">{tag.tag}</span>
                <span className="ml-auto text-[10px] text-[var(--color-ink-faint)]">{tag.endpoints.length}</span>
            </button>
            {open && (
                <ul className="ml-2 border-l border-[var(--color-border)] pl-1">
                    {tag.endpoints.map(e => (
                        <li key={e.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(e.id)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors',
                                    e.id === selectedId
                                        ? 'bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                        : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                                )}
                            >
                                <MethodBadge method={e.method} className="w-12" />
                                <span className={cn('truncate', e.deprecated && 'line-through opacity-60')}>
                                    {e.summary}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function EndpointDetail({ doc, endpoint }: { doc: OpenApiDoc; endpoint: Endpoint }) {
    const { operation } = endpoint;
    const params = operation.parameters ?? [];
    const pathParams = params.filter(p => p.in === 'path');
    const queryParams = params.filter(p => p.in === 'query');
    const headerParams = params.filter(p => p.in === 'header');
    const bodyMedia = jsonMedia(operation.requestBody?.content);
    const bodyRows = bodyMedia?.schema ? flattenProperties(doc, bodyMedia.schema) : [];
    const responseCodes = sortedResponseCodes(operation.responses);

    return (
        <div className="flex flex-col gap-6 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/50 p-6">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-5">
                <div className="flex flex-wrap items-center gap-2">
                    <MethodBadge method={endpoint.method} className="px-2 py-1 text-xs" />
                    <code className="break-all font-mono text-sm text-[var(--color-ink)]">
                        {displayPath(doc, endpoint.path)}
                    </code>
                    {endpoint.deprecated && (
                        <span className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
                            {m['admin.apiDocs.deprecated']()}
                        </span>
                    )}
                </div>
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{endpoint.summary}</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {endpoint.authRequired ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--color-ink-muted)]">
                            <Lock className="h-3 w-3" />
                            {m['admin.apiDocs.authRequired']()}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[var(--color-accent)]">
                            {m['admin.apiDocs.public']()}
                        </span>
                    )}
                    <span className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink-faint)]">
                        {endpoint.tag}
                    </span>
                </div>
                {operation.description && (
                    <p className="whitespace-pre-line text-sm text-[var(--color-ink-muted)]">{operation.description}</p>
                )}
            </div>

            {pathParams.length > 0 && (
                <ParamSection title={m['admin.apiDocs.section.pathParams']()} rows={paramRows(doc, pathParams)} />
            )}
            {queryParams.length > 0 && (
                <ParamSection title={m['admin.apiDocs.section.queryParams']()} rows={paramRows(doc, queryParams)} />
            )}
            {headerParams.length > 0 && (
                <ParamSection title={m['admin.apiDocs.section.headerParams']()} rows={paramRows(doc, headerParams)} />
            )}

            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.apiDocs.section.body']()}</h3>
                {bodyMedia?.schema ? (
                    bodyRows.length > 0 ? (
                        <PropertyTable rows={bodyRows} />
                    ) : (
                        <SchemaFallback label={typeLabel(doc, bodyMedia.schema)} />
                    )
                ) : (
                    <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.apiDocs.noBody']()}</p>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                    {m['admin.apiDocs.section.responses']()}
                </h3>
                {responseCodes.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.apiDocs.noResponses']()}</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {responseCodes.map(code => {
                            const response = operation.responses?.[code];
                            if (!response) return null;
                            return <ResponseBlock key={code} doc={doc} code={code} response={response} />;
                        })}
                    </div>
                )}
            </div>

            <CurlBlock doc={doc} endpoint={endpoint} />
        </div>
    );
}

function paramRows(doc: OpenApiDoc, params: OpenApiParameter[]): PropertyRow[] {
    return params.map(p => ({
        name: p.name,
        type: typeLabel(doc, p.schema),
        required: Boolean(p.required),
        description: p.description,
        enumValues: undefined,
    }));
}

function ParamSection({ title, rows }: { title: string; rows: PropertyRow[] }) {
    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
            <PropertyTable rows={rows} />
        </div>
    );
}

function PropertyTable({ rows }: { rows: PropertyRow[] }) {
    return (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                    <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                        <th className="px-3 py-2 font-medium">{m['admin.apiDocs.col.name']()}</th>
                        <th className="px-3 py-2 font-medium">{m['admin.apiDocs.col.type']()}</th>
                        <th className="px-3 py-2 font-medium">{m['admin.apiDocs.col.required']()}</th>
                        <th className="px-3 py-2 font-medium">{m['admin.apiDocs.col.description']()}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.name} className="border-b border-[var(--color-border)] last:border-0 align-top">
                            <td className="px-3 py-2 font-mono text-xs text-[var(--color-ink)]">{row.name}</td>
                            <td className="px-3 py-2 font-mono text-xs text-[var(--color-ink-muted)]">{row.type}</td>
                            <td className="px-3 py-2 text-xs">
                                {row.required ? (
                                    <span className="text-[var(--color-danger)]">{m['admin.apiDocs.required.yes']()}</span>
                                ) : (
                                    <span className="text-[var(--color-ink-faint)]">{m['admin.apiDocs.required.no']()}</span>
                                )}
                            </td>
                            <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                                {row.description}
                                {row.enumValues && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                        {row.enumValues.map(v => (
                                            <code
                                                key={v}
                                                className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--color-ink-muted)]"
                                            >
                                                {v}
                                            </code>
                                        ))}
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SchemaFallback({ label }: { label: string }) {
    return (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs text-[var(--color-ink-muted)]">
            {label}
        </p>
    );
}

function ResponseBlock({
    doc,
    code,
    response,
}: {
    doc: OpenApiDoc;
    code: string;
    response: { description?: string; content?: Record<string, OpenApiMediaType> };
}) {
    const isSuccess = code.startsWith('2');
    const media = jsonMedia(response.content);
    const rows = media?.schema ? flattenProperties(doc, media.schema) : [];
    const schema = media?.schema ? resolveSchema(doc, media.schema) : undefined;

    return (
        <div className="rounded-lg border border-[var(--color-border)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <span
                    className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold',
                        isSuccess
                            ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                            : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
                    )}
                >
                    {code}
                </span>
                {response.description && (
                    <span className="text-xs text-[var(--color-ink-muted)]">{response.description}</span>
                )}
            </div>
            <div className="px-3 py-2">
                {!media?.schema ? (
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.apiDocs.responseNoBody']()}</p>
                ) : rows.length > 0 ? (
                    <PropertyTable rows={rows} />
                ) : (
                    <SchemaFallback label={typeLabel(doc, schema)} />
                )}
            </div>
        </div>
    );
}

function CurlBlock({ doc, endpoint }: { doc: OpenApiDoc; endpoint: Endpoint }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<number | undefined>(undefined);

    const curl = useMemo(
        () =>
            buildCurl(doc, endpoint, {
                serverUrl: serverUrl(doc),
                tokenPlaceholder: 'ptdl_YOUR_API_TOKEN',
            }),
        [doc, endpoint],
    );

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(curl);
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable — no-op */
        }
    };

    useEffect(() => () => window.clearTimeout(timer.current), []);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.apiDocs.section.curl']()}</h3>
                <button
                    type="button"
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
                >
                    {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? m['admin.apiDocs.copied']() : m['admin.apiDocs.copyCurl']()}
                </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 font-mono text-xs text-[var(--color-ink)]">
                {curl}
            </pre>
        </div>
    );
}
