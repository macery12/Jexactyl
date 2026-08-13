import {
    Activity,
    Archive,
    Boxes,
    Database,
    Download,
    FileCog,
    FilePen,
    FilePlus,
    FileText,
    FolderPlus,
    Folders,
    HardDriveDownload,
    Info,
    Network,
    Power,
    Save,
    Terminal,
    Timer,
    Trash2,
    Wrench,
    type LucideIcon,
} from 'lucide-react';
import { td } from '@/i18n';

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

    activate_tool_group: { icon: Wrench, primary: 'group' },
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

/**
 * The one argument worth showing on a collapsed row.
 */
export function toolTarget(tool: string, args: Record<string, unknown>): string | null {
    const key = META[tool]?.primary;
    if (!key) return null;

    const value = args[key];
    if (value === undefined || value === null) return null;

    const text = String(value);
    return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}
