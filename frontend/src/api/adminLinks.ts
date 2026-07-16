import http from '@/lib/http';

// Admin custom-links module (Application API). Mirrors V1's
// `resources/scripts/api/routes/admin/links.ts` — operator-defined links to
// external sites, surfaced to end users in the sidebar. No backend changes:
// reuses the existing `/api/application/links` surface (index / store / update
// / delete). Per-link `visible` controls whether users see it.

export interface CustomLink {
    id: number;
    name: string;
    url: string;
    visible: boolean;
    createdAt: string;
    updatedAt: string | null;
}

// A Fractal collection row: `{ object, attributes }`.
interface FractalLink {
    attributes: {
        id: number;
        name: string;
        url: string;
        visible: boolean;
        created_at: string;
        updated_at: string | null;
    };
}

function toLink({ attributes: a }: FractalLink): CustomLink {
    return {
        id: a.id,
        name: a.name,
        url: a.url,
        visible: a.visible,
        createdAt: a.created_at,
        updatedAt: a.updated_at ?? null,
    };
}

// The host shown as a link's subtitle. Falls back to the raw string when the
// URL is mid-edit and doesn't parse yet.
export function linkHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

// Matches StoreLinkRequest / CustomLink::$validationRules.
export interface CustomLinkPayload {
    name: string;
    url: string;
    visible: boolean;
}

// GET /api/application/links — the index caps per_page at 100.
export async function getLinks(): Promise<CustomLink[]> {
    const { data } = await http.get('/api/application/links', { params: { per_page: 100 } });
    return (data.data ?? []).map(toLink);
}

export async function createLink(payload: CustomLinkPayload): Promise<CustomLink> {
    const { data } = await http.post('/api/application/links', payload);
    return toLink(data);
}

// PATCH returns 204, so the caller's payload is the new state — the id is
// carried over from the edited record.
export async function updateLink(id: number, payload: CustomLinkPayload): Promise<void> {
    await http.patch(`/api/application/links/${id}`, payload);
}

export async function deleteLink(id: number): Promise<void> {
    await http.delete(`/api/application/links/${id}`);
}
