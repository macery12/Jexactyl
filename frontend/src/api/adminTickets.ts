import http from '@/lib/http';
import type { TicketStatus, TicketPriority } from '@/components/tickets/meta';

// Admin/staff ticket view-models, sourced from the session-authed application
// API (/api/application/tickets). Field names mirror V1's application
// TicketTransformer / TicketMessageTransformer. Unlike the client surface, the
// admin transformer exposes the ticket author, the assignee, and internal notes.

export interface TicketParticipant {
    id: number;
    username: string;
    email: string;
    admin: boolean;
    avatarUrl: string | null;
}

export interface AdminTicketMessage {
    id: number;
    message: string;
    internalNote: boolean;
    author: TicketParticipant | null;
    createdAt: string;
}

export interface AdminTicket {
    id: number;
    title: string;
    status: TicketStatus;
    priority: TicketPriority;
    user: TicketParticipant | null;
    assignedTo: TicketParticipant | null;
    lastReplyAt: string | null;
    createdAt: string;
    updatedAt: string | null;
    // Only populated by getAdminTicket (?include=messages).
    messages?: AdminTicketMessage[];
}

export interface TicketPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminTicketPage {
    items: AdminTicket[];
    pagination: TicketPagination;
}

interface RawUser {
    id: number;
    username: string;
    email: string;
    root_admin?: boolean | number;
    admin_role_id?: number | null;
    avatar_url?: string | null;
}

function mapParticipant(u: RawUser | null | undefined): TicketParticipant | null {
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
        internal_note?: boolean;
        author?: RawUser | null;
        created_at: string;
    };
}

function mapMessage(row: RawMessage): AdminTicketMessage {
    const a = row.attributes;
    return {
        id: a.id,
        message: a.message,
        internalNote: Boolean(a.internal_note),
        author: mapParticipant(a.author),
        createdAt: a.created_at,
    };
}

interface RawTicket {
    attributes: {
        id: number;
        title: string;
        status: TicketStatus;
        priority: TicketPriority;
        user?: RawUser | null;
        assigned_to?: RawUser | null;
        last_reply_at: string | null;
        created_at: string;
        updated_at: string | null;
        relationships?: {
            messages?: { data?: RawMessage[] };
        };
    };
}

function mapTicket(row: RawTicket): AdminTicket {
    const a = row.attributes;
    const messages = a.relationships?.messages?.data;
    return {
        id: a.id,
        title: a.title,
        status: a.status,
        priority: a.priority,
        user: mapParticipant(a.user),
        assignedTo: mapParticipant(a.assigned_to),
        lastReplyAt: a.last_reply_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        messages: messages ? messages.map(mapMessage) : undefined,
    };
}

export interface AdminTicketQuery {
    page?: number;
    perPage?: number;
    status?: TicketStatus;
    priority?: TicketPriority;
    /** One of the allowed sorts; prefix with '-' for descending. */
    sort?: string;
}

// GET /api/application/tickets — paginated, filterable list for the staff queue.
export async function getAdminTickets(query: AdminTicketQuery = {}): Promise<AdminTicketPage> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 25,
        sort: query.sort ?? '-last_reply_at',
    };
    if (query.status) params['filter[status]'] = query.status;
    if (query.priority) params['filter[priority]'] = query.priority;

    const { data } = await http.get('/api/application/tickets', { params });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map(mapTicket),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? (query.perPage ?? 25),
        },
    };
}

// GET /api/application/tickets/{id}?include=messages — full ticket with the
// complete conversation, including internal staff notes.
export async function getAdminTicket(id: number): Promise<AdminTicket> {
    const { data } = await http.get(`/api/application/tickets/${id}`, { params: { include: 'messages' } });
    return mapTicket(data);
}

export interface UpdateAdminTicketInput {
    title: string;
    userId: number;
    status: TicketStatus;
    priority: TicketPriority;
    assignedTo: number | null;
}

// PUT /api/application/tickets/{id} — the update request validates the full
// Ticket rule set, so every field is sent even when only one changed.
export async function updateAdminTicket(id: number, input: UpdateAdminTicketInput): Promise<AdminTicket> {
    const { data } = await http.put(`/api/application/tickets/${id}`, {
        title: input.title,
        user_id: input.userId,
        status: input.status,
        priority: input.priority,
        assigned_to: input.assignedTo,
    });
    return mapTicket(data);
}

// POST /api/application/tickets/message — post a public reply or an internal note.
export async function replyAdminTicket(
    ticketId: number,
    message: string,
    internalNote: boolean,
): Promise<AdminTicketMessage> {
    const { data } = await http.post('/api/application/tickets/message', {
        ticket_id: ticketId,
        message,
        internal_note: internalNote,
    });
    return mapMessage(data);
}

// DELETE /api/application/tickets/{id} — permanently delete a ticket + messages.
export async function deleteAdminTicket(id: number): Promise<void> {
    await http.delete(`/api/application/tickets/${id}`);
}
