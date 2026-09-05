import http from '@/lib/http';
import type { TicketStatus, TicketPriority } from '@/components/tickets/meta';

// Client-facing ticket view-models, sourced from the cookie-authed client API
// (/api/client/account/tickets — the same surface the account dashboard uses). Field
// names mirror V1's client TicketTransformer / TicketMessageTransformer.

export interface TicketAuthor {
    id: number;
    username: string;
    email: string;
    admin: boolean;
    avatarUrl: string | null;
}

export interface TicketMessage {
    id: number;
    message: string;
    author: TicketAuthor | null;
    createdAt: string;
}

export interface TicketServer {
    id: number;
    identifier: string;
    name: string;
}

export interface Ticket {
    id: number;
    title: string;
    status: TicketStatus;
    priority: TicketPriority;
    serverId: number | null;
    server: TicketServer | null;
    lastReplyAt: string | null;
    createdAt: string;
    updatedAt: string | null;
    // Only populated by getTicket (?include=messages).
    messages?: TicketMessage[];
}

// The Fractal transformer emits `author` as a raw (nested) user model rather
// than a wrapped resource, so this shape is intentionally loose.
interface RawUser {
    id: number;
    username: string;
    email: string;
    root_admin?: boolean | number;
    admin_role_id?: number | null;
    avatar_url?: string | null;
}

function mapAuthor(u: RawUser | null | undefined): TicketAuthor | null {
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        email: u.email,
        admin: Boolean(u.admin_role_id),
        avatarUrl: u.avatar_url ?? null,
    };
}

interface RawMessage {
    attributes: {
        id: number;
        message: string;
        author?: RawUser | null;
        created_at: string;
    };
}

function mapMessage(row: RawMessage): TicketMessage {
    const a = row.attributes;
    return {
        id: a.id,
        message: a.message,
        author: mapAuthor(a.author),
        createdAt: a.created_at,
    };
}

interface RawTicket {
    attributes: {
        id: number;
        title: string;
        status: TicketStatus;
        priority: TicketPriority;
        server_id?: number | null;
        server?: TicketServer | null;
        last_reply_at: string | null;
        created_at: string;
        updated_at: string | null;
        relationships?: {
            messages?: { data?: RawMessage[] };
        };
    };
}

function mapTicket(row: RawTicket): Ticket {
    const a = row.attributes;
    const messages = a.relationships?.messages?.data;
    return {
        id: a.id,
        title: a.title,
        status: a.status,
        priority: a.priority,
        serverId: a.server_id ?? null,
        server: a.server ?? null,
        lastReplyAt: a.last_reply_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        messages: messages ? messages.map(mapMessage) : undefined,
    };
}

// GET /api/client/account/tickets — every ticket the signed-in user owns (unpaginated
// Fractal collection).
export async function getTickets(): Promise<Ticket[]> {
    const { data } = await http.get('/api/client/account/tickets');
    return (data.data ?? []).map(mapTicket);
}

// GET /api/client/account/tickets/{id}?include=messages — a single ticket and its
// visible conversation (internal staff notes are stripped server-side).
export async function getTicket(id: number): Promise<Ticket> {
    const { data } = await http.get(`/api/client/account/tickets/${id}`, { params: { include: 'messages' } });
    return mapTicket(data);
}

// POST /api/client/account/tickets — open a new ticket with its first message.
export async function createTicket(input: { title: string; message: string; serverId: number | null }): Promise<Ticket> {
    const { data } = await http.post('/api/client/account/tickets', {
        title: input.title,
        message: input.message,
        server_id: input.serverId,
    });
    return mapTicket(data);
}

// POST /api/client/account/tickets/{id}/messages — append a reply to a ticket.
export async function replyToTicket(id: number, message: string): Promise<Ticket> {
    const { data } = await http.post(`/api/client/account/tickets/${id}/messages`, { message });
    return mapTicket(data);
}

// DELETE /api/client/account/tickets/{id} — remove a ticket the user owns.
export async function deleteTicket(id: number): Promise<void> {
    await http.delete(`/api/client/account/tickets/${id}`);
}
