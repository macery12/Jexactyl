// Minimal OpenAPI 3.x reader for the API Docs page. Scramble emits a standard
// 3.1 document (paths + components.schemas, heavy `$ref` usage). We don't need a
// full validator — just enough to group endpoints, flatten one level of schema
// into readable property rows, and build an example cURL. Everything here is
// pure and side-effect free so the page can memoize over it.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export const METHOD_ORDER: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export type EndpointGroup = 'client' | 'application' | 'other';

// A `$ref` or an inline schema. We keep it loose — Scramble mixes both.
export interface OpenApiSchema {
    $ref?: string;
    type?: string | string[];
    format?: string;
    nullable?: boolean;
    enum?: unknown[];
    items?: OpenApiSchema;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
    allOf?: OpenApiSchema[];
    oneOf?: OpenApiSchema[];
    anyOf?: OpenApiSchema[];
    description?: string;
    example?: unknown;
    default?: unknown;
    title?: string;
}

export interface OpenApiParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema?: OpenApiSchema;
}

export interface OpenApiMediaType {
    schema?: OpenApiSchema;
    example?: unknown;
}

export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
    parameters?: OpenApiParameter[];
    requestBody?: { description?: string; required?: boolean; content?: Record<string, OpenApiMediaType> };
    responses?: Record<string, { description?: string; content?: Record<string, OpenApiMediaType> }>;
    security?: Array<Record<string, unknown>>;
}

export interface OpenApiDoc {
    openapi?: string;
    info?: { title?: string; version?: string; description?: string };
    servers?: Array<{ url: string; description?: string }>;
    paths?: Record<string, Record<string, OpenApiOperation>>;
    components?: { schemas?: Record<string, OpenApiSchema> };
    security?: Array<Record<string, unknown>>;
}

export interface Endpoint {
    id: string;
    method: HttpMethod;
    path: string;
    group: EndpointGroup;
    tag: string;
    summary: string;
    description?: string;
    deprecated: boolean;
    authRequired: boolean;
    operation: OpenApiOperation;
}

// A single flattened row for a params / schema table.
export interface PropertyRow {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    enumValues?: string[];
}

// Scramble strips the `api_path` prefix, so paths in the document look like
// `/client/servers` / `/application/users`; the `/api` base lives on the server
// URL. Group off the leading segment.
const GROUP_PREFIX: Record<Exclude<EndpointGroup, 'other'>, string> = {
    client: '/client',
    application: '/application',
};

function classifyGroup(path: string): EndpointGroup {
    if (path === GROUP_PREFIX.client || path.startsWith(`${GROUP_PREFIX.client}/`)) return 'client';
    if (path === GROUP_PREFIX.application || path.startsWith(`${GROUP_PREFIX.application}/`)) return 'application';
    return 'other';
}

// Base API URL (e.g. `https://panel.example/api`) and its path portion
// (`/api`), used to reconstruct the real callable URL for display + cURL.
export function serverUrl(doc: OpenApiDoc | undefined): string {
    const raw = doc?.servers?.[0]?.url?.trim();
    if (raw) return raw.replace(/\/$/, '');
    if (typeof window !== 'undefined') return `${window.location.origin}/api`;
    return '/api';
}

export function apiBasePath(doc: OpenApiDoc | undefined): string {
    try {
        return new URL(serverUrl(doc), 'http://localhost').pathname.replace(/\/$/, '');
    } catch {
        return '';
    }
}

// The full, callable path shown in the reference (e.g. `/api/client/servers`).
export function displayPath(doc: OpenApiDoc | undefined, path: string): string {
    return `${apiBasePath(doc)}${path}`;
}

// Flatten every path/method into a comparable list of endpoints, grouped and
// tagged. `authRequired` reflects a per-operation (or document-level) security
// requirement — Scramble marks these via the BearerToken scheme.
export function parseEndpoints(doc: OpenApiDoc | undefined): Endpoint[] {
    if (!doc?.paths) return [];
    const docSecure = Array.isArray(doc.security) && doc.security.length > 0;
    const out: Endpoint[] = [];

    for (const [path, methods] of Object.entries(doc.paths)) {
        for (const [rawMethod, operation] of Object.entries(methods)) {
            const method = rawMethod.toLowerCase() as HttpMethod;
            if (!METHOD_ORDER.includes(method)) continue;
            const opSecure = operation.security === undefined ? docSecure : operation.security.length > 0;
            out.push({
                id: `${method}:${path}`,
                method,
                path,
                group: classifyGroup(path),
                tag: operation.tags?.[0] ?? 'General',
                summary: operation.summary || defaultSummary(method, path),
                description: operation.description,
                deprecated: Boolean(operation.deprecated),
                authRequired: opSecure,
                operation,
            });
        }
    }

    return out;
}

function defaultSummary(method: HttpMethod, path: string): string {
    return `${method.toUpperCase()} ${path}`;
}

// Follow a local `#/components/schemas/Name` reference. Foreign refs are left
// unresolved (returned as an empty schema) — Scramble only emits local ones.
function resolveRef(doc: OpenApiDoc, ref: string): OpenApiSchema {
    const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
    if (!name) return {};
    return doc.components?.schemas?.[name] ?? {};
}

// Resolve a possibly-`$ref`'d schema one hop, merging `allOf` and collapsing a
// single-branch oneOf/anyOf so the caller sees a concrete object schema.
export function resolveSchema(doc: OpenApiDoc, schema: OpenApiSchema | undefined, depth = 0): OpenApiSchema {
    if (!schema || depth > 8) return {};
    if (schema.$ref) return resolveSchema(doc, resolveRef(doc, schema.$ref), depth + 1);

    if (schema.allOf?.length) {
        const merged: OpenApiSchema = { type: 'object', properties: {}, required: [] };
        for (const branch of schema.allOf) {
            const r = resolveSchema(doc, branch, depth + 1);
            Object.assign(merged.properties!, r.properties ?? {});
            merged.required!.push(...(r.required ?? []));
            if (r.type && !merged.type) merged.type = r.type;
        }
        return merged;
    }

    const branch = schema.oneOf?.[0] ?? schema.anyOf?.[0];
    if (branch && !schema.type && !schema.properties) return resolveSchema(doc, branch, depth + 1);

    return schema;
}

// Human-readable one-line type label for a schema cell ("string", "Server[]",
// "object", "string · email"…).
export function typeLabel(doc: OpenApiDoc, schema: OpenApiSchema | undefined, depth = 0): string {
    if (!schema || depth > 8) return 'any';
    if (schema.$ref) {
        const name = /schemas\/(.+)$/.exec(schema.$ref)?.[1];
        return name ?? 'object';
    }
    const resolved = schema.allOf || schema.oneOf || schema.anyOf ? resolveSchema(doc, schema, depth) : schema;
    const base = Array.isArray(resolved.type) ? resolved.type.join(' | ') : resolved.type;

    if (base === 'array' || resolved.items) {
        const inner = resolved.items?.$ref
            ? /schemas\/(.+)$/.exec(resolved.items.$ref)?.[1] ?? 'object'
            : typeLabel(doc, resolved.items, depth + 1);
        return `${inner}[]`;
    }
    if (!base && resolved.properties) return 'object';
    if (base && resolved.format) return `${base} · ${resolved.format}`;
    return base ?? 'any';
}

// One level of properties from an object schema, as table rows. Nested objects
// are shown by type only (not recursed) to keep the reference scannable.
export function flattenProperties(doc: OpenApiDoc, schema: OpenApiSchema | undefined): PropertyRow[] {
    const resolved = resolveSchema(doc, schema);
    const props = resolved.properties;
    if (!props) return [];
    const required = new Set(resolved.required ?? []);
    return Object.entries(props).map(([name, prop]) => {
        const enumValues = prop.enum?.map(v => String(v)) ?? undefined;
        return {
            name,
            type: typeLabel(doc, prop),
            required: required.has(name),
            description: prop.description,
            enumValues: enumValues && enumValues.length <= 12 ? enumValues : undefined,
        } satisfies PropertyRow;
    });
}

// Pull the JSON media type out of a request/response body (falls back to the
// first available content type).
export function jsonMedia(content: Record<string, OpenApiMediaType> | undefined): OpenApiMediaType | undefined {
    if (!content) return undefined;
    return content['application/json'] ?? Object.values(content)[0];
}

// Build a minimal example object from a body schema for the cURL `-d` payload.
function exampleFromSchema(doc: OpenApiDoc, schema: OpenApiSchema | undefined, depth = 0): unknown {
    const resolved = resolveSchema(doc, schema, depth);
    if (resolved.example !== undefined) return resolved.example;
    if (resolved.default !== undefined) return resolved.default;
    if (resolved.enum?.length) return resolved.enum[0];

    const base = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
    if (base === 'array' || resolved.items) return depth > 4 ? [] : [exampleFromSchema(doc, resolved.items, depth + 1)];
    if (resolved.properties && depth <= 4) {
        const obj: Record<string, unknown> = {};
        for (const [name, prop] of Object.entries(resolved.properties)) {
            obj[name] = exampleFromSchema(doc, prop, depth + 1);
        }
        return obj;
    }
    switch (base) {
        case 'integer':
        case 'number':
            return 0;
        case 'boolean':
            return true;
        case 'object':
            return {};
        default:
            return resolved.format === 'email' ? 'user@example.com' : 'string';
    }
}

export interface CurlOptions {
    serverUrl: string;
    tokenPlaceholder: string;
}

// Assemble a copy-pasteable cURL example for an endpoint. Path params are shown
// as `:name`, query params appended, and a JSON body scaffold added for
// body-bearing methods.
export function buildCurl(doc: OpenApiDoc, endpoint: Endpoint, opts: CurlOptions): string {
    const { operation } = endpoint;
    const params = operation.parameters ?? [];

    let path = endpoint.path;
    for (const p of params.filter(p => p.in === 'path')) {
        path = path.replace(`{${p.name}}`, `:${p.name}`);
    }

    const query = params
        .filter(p => p.in === 'query')
        .map(p => `${encodeURIComponent(p.name)}=${p.required ? `<${p.name}>` : ''}`)
        .join('&');

    const url = `${opts.serverUrl.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;

    const lines = [`curl -X ${endpoint.method.toUpperCase()} '${url}' \\`];
    if (endpoint.authRequired) lines.push(`  -H 'Authorization: Bearer ${opts.tokenPlaceholder}' \\`);
    lines.push(`  -H 'Accept: application/json'`);

    const media = jsonMedia(operation.requestBody?.content);
    if (media?.schema) {
        lines[lines.length - 1] += ' \\';
        lines.push(`  -H 'Content-Type: application/json' \\`);
        const body = media.example ?? exampleFromSchema(doc, media.schema);
        lines.push(`  -d '${JSON.stringify(body, null, 2)}'`);
    }

    return lines.join('\n');
}

// Sort responses so 2xx come first, then ascending status; "default" last.
export function sortedResponseCodes(responses: Record<string, unknown> | undefined): string[] {
    if (!responses) return [];
    return Object.keys(responses).sort((a, b) => {
        if (a === 'default') return 1;
        if (b === 'default') return -1;
        return Number(a) - Number(b);
    });
}
