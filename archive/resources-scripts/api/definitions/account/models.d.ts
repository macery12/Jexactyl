import { Model, UUID } from '@definitions';
import { SubuserPermission } from '@/state/server/subusers';

interface User extends Model {
    uuid: string;
    username: string;
    email: string;
    image: string;
    twoFactorEnabled: boolean;
    emailVerified: boolean;
    createdAt: Date;
    permissions: SubuserPermission[];
    can(permission: SubuserPermission): boolean;
}

interface SSHKey extends Model {
    name: string;
    public_key: string;
    fingerprint: string;
    created_at: Date;
}

interface ApiKey extends Model {
    id?: number;
    identifier: string;
    description: string;
    allowedIps: string[];
    createdAt: Date | null;
    lastUsedAt: Date | null;
}

interface AccountSession extends Model {
    id: number;
    deviceName: string;
    deviceLabel: string | null;
    ipAddress: string | null;
    location: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastActivityAt: Date | null;
    revokedAt: Date | null;
    isCurrent: boolean;
}

interface Ticket extends Model {
    id: number;
    title: string;
    status: 'resolved' | 'unresolved' | 'pending' | 'in-progress';
    priority: 'low' | 'medium' | 'high' | 'critical';
    lastReplyAt: Date | null;
    createdAt: Date;
    updatedAt: Date | null;
    relationships: {
        messages: TicketMessage[] | null;
    };
}

interface TicketMessage extends Model {
    id: number;
    message: string;
    author: User;
    createdAt: Date;
    updatedAt?: Date | null;
}

interface ActivityLog extends Model<'actor'> {
    id: string;
    batch: UUID | null;
    event: string;
    ip: string | null;
    isApi: boolean;
    isAdmin: boolean;
    description: string | null;
    properties: Record<string, string | unknown>;
    hasAdditionalMetadata: boolean;
    timestamp: Date;
    scope: 'account' | 'server' | 'admin';
    context: string;
    category: string;
    source: string;
    severity: string;
    relationships: {
        actor: User | null;
    };
}
