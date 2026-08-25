import {
    Activity,
    Archive,
    Boxes,
    ChartLine,
    Container,
    Database,
    Download,
    FileCog,
    FilePen,
    FilePlus,
    FileText,
    FolderPlus,
    Folders,
    Gauge,
    HardDriveDownload,
    HelpCircle,
    Info,
    Layers,
    Search,
    LifeBuoy,
    Network,
    Package,
    Power,
    Receipt,
    Save,
    Server,
    ShieldAlert,
    Terminal,
    Ticket,
    Timer,
    ToggleLeft,
    Trash2,
    Users,
    Wrench,
    type LucideIcon,
} from 'lucide-react';
import { td } from '@/i18n/messages';

// Presentation for a tool call: an icon, a short verb, and which argument is
// worth putting on the collapsed row.
//
// The argument matters as much as the verb — "Read" tells you nothing, "Read
// config/iceandfire-common.toml" tells you everything. Tools absent from the
// map still render, just without an icon or a highlighted argument, so a new
// backend tool degrades rather than breaks.

interface ToolMeta {
    icon: LucideIcon;
    /** Argument shown beside the verb on the collapsed row. */
    primary?: string;
}

const META: Record<string, ToolMeta> = {
    server_status: { icon: Info },
    server_power: { icon: Power, primary: 'signal' },
    console_send: { icon: Terminal, primary: 'command' },
    activity_recent: { icon: Activity },

    startup_list: { icon: FileCog },
    startup_set: { icon: FileCog, primary: 'key' },
    startup_image_set: { icon: Container, primary: 'docker_image' },

    files_list: { icon: Folders, primary: 'directory' },
    files_read: { icon: FileText, primary: 'file' },
    files_write: { icon: FilePen, primary: 'file' },
    files_create_folder: { icon: FolderPlus, primary: 'name' },
    files_rename: { icon: FilePlus, primary: 'root' },
    files_copy: { icon: FilePlus, primary: 'location' },
    files_delete: { icon: Trash2, primary: 'root' },
    files_compress: { icon: Archive, primary: 'root' },
    files_decompress: { icon: Archive, primary: 'file' },
    files_download_url: { icon: Download, primary: 'file' },

    backups_list: { icon: Save },
    backup_create: { icon: Save, primary: 'name' },
    backup_restore: { icon: HardDriveDownload, primary: 'backup' },
    backup_delete: { icon: Trash2, primary: 'backup' },

    databases_list: { icon: Database },
    schedules_list: { icon: Timer },
    allocations_list: { icon: Network },

    minecraft_server_info: { icon: Info },
    mods_installed: { icon: Boxes },

    // The query is the whole content of a search row — "looked for: read the
    // startup command" is the most legible thing the transcript can say about a
    // step that otherwise looks like the agent doing nothing.
    search_tools: { icon: Search, primary: 'query' },
    load_tools: { icon: Wrench, primary: 'tools' },
    ask_user: { icon: HelpCircle, primary: 'question' },
    // No primary: the summary is rendered by the batch preview itself, above the
    // list, where it introduces the set rather than labelling one row of it.
    batch: { icon: Layers },

    // Admin scope. Every name is prefixed so it cannot collide with a
    // server-scoped tool in the registry's flat name map.
    admin_overview: { icon: Gauge },
    admin_users_list: { icon: Users },
    admin_user_view: { icon: Users, primary: 'user' },
    admin_servers_list: { icon: Server },
    admin_server_view: { icon: Server, primary: 'server' },
    admin_activity: { icon: Activity },

    admin_billing_analytics: { icon: ChartLine },
    admin_categories_list: { icon: Folders },
    admin_products_list: { icon: Package },
    admin_product_view: { icon: Package, primary: 'product' },
    admin_cycles_list: { icon: Timer, primary: 'product' },
    admin_product_create: { icon: Package, primary: 'name' },
    admin_product_update: { icon: Package, primary: 'product' },

    admin_coupons_list: { icon: Ticket },
    admin_coupon_view: { icon: Ticket, primary: 'coupon' },
    admin_coupon_create: { icon: Ticket, primary: 'code' },
    admin_coupon_update: { icon: Ticket, primary: 'coupon' },
    admin_orders_list: { icon: Receipt },
    admin_node_pricing_list: { icon: ChartLine },
    admin_node_pricing_update: { icon: ChartLine, primary: 'id' },

    admin_tickets_list: { icon: LifeBuoy },
    admin_ticket_view: { icon: LifeBuoy, primary: 'ticket' },
    admin_ticket_messages: { icon: LifeBuoy, primary: 'ticket' },
    // The server is the primary argument rather than the reason: the row has to
    // answer "whose server?" at a glance, and the reason is on the banner.
    admin_assist_server: { icon: ShieldAlert, primary: 'server' },
    admin_assist_allow_writes: { icon: ShieldAlert },

    admin_features: { icon: ToggleLeft },
    admin_presets_list: { icon: Boxes },
};

/**
 * Rendered as a component rather than returning one, so callers never assign a
 * component to a local during render.
 */
export function ToolIcon({ tool, className }: { tool: string; className?: string }) {
    const Icon: LucideIcon = META[tool]?.icon ?? Wrench;

    return <Icon className={className} />;
}

/**
 * The human label for a tool. Falls back to the raw name with underscores
 * spaced out, so an unlocalised tool still reads as words.
 */
export function toolLabel(tool: string): string {
    return td(`server.ai.tools.${tool}`, tool.replace(/_/g, ' '));
}

export type ToolLifecycleStatus = 'pending' | 'running' | 'ok' | 'partial' | 'error';

/**
 * Label a transcript row without claiming that a mutation happened before its
 * result proves it. Most historical labels are already neutral enough for
 * every state; files_write is deliberately explicit because its old "Wrote"
 * label appeared as soon as the model named the call, including while approval
 * attestation was still running and after a failed write.
 */
export function toolLifecycleLabel(tool: string, status: ToolLifecycleStatus): string {
    if (tool !== 'files_write') return toolLabel(tool);

    switch (status) {
        case 'pending':
            return td('server.ai.tools.files_write.pending', 'Preparing file write');
        case 'running':
            return td('server.ai.tools.files_write.running', 'Attempting file write');
        case 'ok':
            return td('server.ai.tools.files_write.ok', 'Wrote');
        case 'partial':
            return td('server.ai.tools.files_write.partial', 'File write incomplete');
        case 'error':
            return td('server.ai.tools.files_write.error', 'File write failed');
    }
}

/**
 * The one argument worth showing on a collapsed row.
 */
export function toolTarget(tool: string, args: Record<string, unknown>): string | null {
    const key = toolTargetKey(tool);
    if (!key) return null;

    const value = args[key];
    if (value === undefined || value === null) return null;

    // Keep the semantic value exact. Compact tool rows may crop this with CSS,
    // but approval cards also render the same string in a scrollable block.
    // Cutting it here made two long paths with the same prefix indistinguishable
    // everywhere, including to assistive technology.
    return String(value);
}

/** The argument represented by `toolTarget`, for surfaces that show it in full. */
export function toolTargetKey(tool: string): string | null {
    return META[tool]?.primary ?? null;
}
