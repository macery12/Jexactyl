import {
    Puzzle,
    Users,
    Gamepad2,
    Box,
    Server,
    Link as LinkIcon,
    Wrench,
    ShieldHalf,
    Terminal,
    Globe,
    Database,
    LineChart,
    Bell,
    Bot,
    Cloud,
    Folder,
    File,
    Key,
    Zap,
    Cog,
    Lock,
    Scroll,
    MessageCircle,
    Image,
    type LucideIcon,
} from 'lucide-react';

// Manifest `icon` slug → lucide icon. The slugs are V1's contract with
// extension authors (ExtensionsContainer's iconMap), so they're kept identical
// here and mapped onto the V2 icon set. Unknown slugs fall back to Puzzle.
const ICONS: Record<string, LucideIcon> = {
    puzzle: Puzzle,
    users: Users,
    gamepad: Gamepad2,
    cube: Box,
    server: Server,

    // `image` isn't in V1's map (the icon-builder extension ships it and falls
    // back to a puzzle piece there); covering it costs nothing.
    image: Image,
    discord: MessageCircle,
    link: LinkIcon,
    wrench: Wrench,
    shield: ShieldHalf,
    terminal: Terminal,
    globe: Globe,
    database: Database,
    chart: LineChart,
    bell: Bell,
    robot: Bot,
    cloud: Cloud,
    folder: Folder,
    file: File,
    key: Key,
    bolt: Zap,
    cogs: Cog,
    lock: Lock,
    scroll: Scroll,
};

export function extensionIcon(slug: string): LucideIcon {
    return ICONS[slug] ?? Puzzle;
}
