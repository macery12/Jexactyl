import { useServer } from '@/components/server/ServerContext';
import { StatStrip } from './panels/StatStrip';
import { ConsolePanel } from './panels/ConsolePanel';
import { PowerPanel } from './panels/PowerPanel';
import { UsagePanel } from './panels/UsagePanel';
import { InfoPanel } from './panels/InfoPanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { ActivityPanel } from './panels/ActivityPanel';

// Static, ops-grade server cockpit: live metric strip, console hero with a
// right rail (power / usage / info), and a network + activity row beneath.
// Fixed layout — not user-editable by design.
export default function ServerOverviewPage() {
    // Touch the context so this page errors clearly if mounted outside the
    // server layout, and so panels can rely on it being present.
    useServer();

    return (
        <div className="relative flex flex-col gap-4">
            <div className="bg-grid pointer-events-none absolute inset-x-0 -top-6 h-72 -z-10 opacity-60" />

            <StatStrip />

            <div className="grid gap-4 xl:grid-cols-3">
                <div className="flex xl:col-span-2">
                    <ConsolePanel />
                </div>
                <div className="flex flex-col gap-4">
                    <PowerPanel />
                    <UsagePanel />
                    <InfoPanel />
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <NetworkPanel />
                <ActivityPanel />
            </div>
        </div>
    );
}
