import type { LucideIcon } from 'lucide-react';
import type { Flags, RouteDef } from './registry';
import { can } from '@/lib/can';

export interface NavItem {
    to: string;
    name: string;
    icon?: LucideIcon;
    category?: string;
    end?: boolean;
}

export interface NavGroup {
    category: string | null;
    items: NavItem[];
}

function toPath(basePath: string, routePath: string): string {
    const clean = routePath.replace(/\/?\*$/, ''); // drop trailing /* or *
    if (clean === '') return basePath;
    return `${basePath}/${clean}`;
}

// Filter the registry to nav-visible entries (name + permission + flag gates),
// resolve their links, and group by category preserving registry order.
export function buildNav(
    routes: RouteDef[],
    opts: { flags: Flags | null; held: string[]; basePath: string },
): NavGroup[] {
    const groups: NavGroup[] = [];
    const byCategory = new Map<string | null, NavItem[]>();

    for (const r of routes) {
        if (!r.name) continue; // unnamed routes are reachable but hidden
        if (r.path.includes(':')) continue; // parameterized detail routes aren't nav targets
        if (r.condition && opts.flags && !r.condition(opts.flags)) continue;
        if (r.permission && !can(opts.held, r.permission)) continue;

        const category = r.category ?? null;
        const item: NavItem = {
            to: toPath(opts.basePath, r.path),
            name: r.name,
            icon: r.icon,
            category: r.category,
            end: r.end,
        };
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
            groups.push({ category, items: byCategory.get(category)! });
        }
        byCategory.get(category)!.push(item);
    }

    return groups;
}
