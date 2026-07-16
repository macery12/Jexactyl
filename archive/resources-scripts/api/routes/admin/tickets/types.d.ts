export type TicketStatus = 'resolved' | 'unresolved' | 'in-progress' | 'pending';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Values {
    title?: string;
    user_id?: number;
    assigned_to?: number | null;
    status?: TicketStatus;
    priority?: TicketPriority;
}

export interface TicketFilters {
    id?: number;
    title?: string;
    user?: User;
    assigned_to?: User;
    status?: TicketStatus;
    priority?: TicketPriority;
    created_at?: Date;
    updated_at?: Date | null;
}

export interface TicketMessageFilters {
    id?: number;
}

export interface CreateTicketMessageValues {
    ticket_id: number;
    message: string;
    internal_note?: boolean;
}
