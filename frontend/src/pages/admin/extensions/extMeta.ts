import {
    Puzzle,
    Bot,
    ShieldCheck,
    Mail,
    Webhook,
    CreditCard,
    Globe,
    LifeBuoy,
    Bell,
    Database,
    Server,
    Users,
    KeyRound,
    BookOpen,
    Palette,
    Boxes,
    Zap,
    MessageSquare,
    Gamepad2,
    Map,
    Wrench,
    Plug,
    type LucideIcon,
} from 'lucide-react';
import type { Extension } from '@/api/extensions';

// Manifests advertise an icon by name (e.g. "puzzle", "discord", "player").
// Resolve to a Lucide glyph, falling back to the generic plug for anything
// unrecognised. Keys are normalised (lower-case, separators stripped).
const ICONS: Record<string, LucideIcon> = {
    puzzle: Puzzle,
    bot: Bot,
    ai: Bot,
    shield: ShieldCheck,
    shieldcheck: ShieldCheck,
    auth: ShieldCheck,
    security: ShieldCheck,
    mail: Mail,
    email: Mail,
    webhook: Webhook,
    webhooks: Webhook,
    billing: CreditCard,
    creditcard: CreditCard,
    payment: CreditCard,
    globe: Globe,
    domain: Globe,
    domains: Globe,
    ticket: LifeBuoy,
    tickets: LifeBuoy,
    support: LifeBuoy,
    bell: Bell,
    alert: Bell,
    alerts: Bell,
    notification: Bell,
    database: Database,
    db: Database,
    server: Server,
    node: Server,
    users: Users,
    user: Users,
    player: Gamepad2,
    players: Gamepad2,
    playermanager: Gamepad2,
    gamepad: Gamepad2,
    key: KeyRound,
    api: KeyRound,
    book: BookOpen,
    docs: BookOpen,
    palette: Palette,
    theme: Palette,
    box: Boxes,
    boxes: Boxes,
    marketplace: Boxes,
    mods: Boxes,
    zap: Zap,
    discord: MessageSquare,
    discordsrv: MessageSquare,
    chat: MessageSquare,
    message: MessageSquare,
    map: Map,
    wrench: Wrench,
    tools: Wrench,
    plug: Plug,
};

export function resolveExtensionIcon(name: string | null | undefined): LucideIcon {
    if (!name) return Plug;
    const key = name.toLowerCase().replace(/[-_\s]/g, '');
    return ICONS[key] ?? Plug;
}

export type ExtensionTone = 'core' | 'enabled' | 'installed' | 'available' | 'update';

// A single derived "tone" drives every status-coloured surface for an extension
// (badge, icon ring, accent) so the card and the drawer stay visually in sync.
export function extensionTone(ext: Extension): ExtensionTone {
    if (ext.updateAvailable) return 'update';
    if (ext.status === 'available') return 'available';
    if (ext.status === 'core') return 'core';
    return ext.enabled ? 'enabled' : 'installed';
}

// CSS-variable colour for a tone. Returned as a raw var() so callers can drop it
// into inline styles (border/box-shadow tints) where Tailwind arbitrary values
// would be awkward. Always a theme token — never a hardcoded colour.
export function toneVar(tone: ExtensionTone): string {
    switch (tone) {
        case 'enabled':
            return 'var(--color-accent)';
        case 'update':
            return 'var(--color-warning)';
        case 'available':
            return 'var(--brand)';
        case 'core':
        case 'installed':
        default:
            return 'var(--color-ink-faint)';
    }
}

type ToneLabelKey = 'status.updateAvailable' | 'status.available' | 'status.core' | 'status.installed';

// i18n key (in the `extensions` namespace) for a tone's badge label.
export function toneLabelKey(tone: ExtensionTone): ToneLabelKey {
    switch (tone) {
        case 'update':
            return 'status.updateAvailable';
        case 'available':
            return 'status.available';
        case 'core':
            return 'status.core';
        case 'enabled':
        case 'installed':
        default:
            return 'status.installed';
    }
}
