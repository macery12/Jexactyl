import { CalendarIcon } from '@heroicons/react/solid';
import { Link } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import type { Server } from '@definitions/server';
import classNames from 'classnames';

interface Props {
    servers: Server[];
    totalCount: number;
    billingEnabled: boolean;
    useTotp: boolean;
}

export default ({ servers, totalCount, billingEnabled, useTotp }: Props) => {
    const operational = servers.filter(s => !s.status).length;
    const suspended = servers.filter(s => s.status === 'suspended').length;
    const yoursCount = servers.filter(s => s.serverOwner !== false).length;
    const sharedCount = servers.filter(s => s.serverOwner === false).length;
    const uptimePct = servers.length > 0 ? Math.round((operational / servers.length) * 100) : 100;

    const deletionCount = servers.filter(s => s.isDeletionScheduled).length;
    const alertCount = (useTotp ? 0 : 1) + deletionCount;
    const alertLabel = !useTotp
        ? '2FA not enabled'
        : deletionCount > 0
          ? `${deletionCount} deletion${deletionCount > 1 ? 's' : ''} pending`
          : 'No alerts';

    const nextRenewal = servers
        .filter(s => s.renewalDate && isValid(s.renewalDate))
        .map(s => s.renewalDate!)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    return (
        <div className="mb-4">
            {/* Amber renewal banner */}
            {billingEnabled && nextRenewal && (
                <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3">
                    <CalendarIcon className="h-4 w-4 flex-shrink-0 text-amber-400" />
                    <span className="flex-1 text-sm text-amber-300">
                        Next renewal on {format(nextRenewal, 'MMM d')}
                    </span>
                    <Link
                        to="/account/billing"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-amber-400 transition-colors hover:text-amber-300"
                    >
                        Manage billing →
                    </Link>
                </div>
            )}

            {/* Slim status bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-1.5 text-sm">
                {/* Servers — always shown */}
                <span className="flex items-center gap-1.5 text-gray-300">
                    <span className="h-2 w-2 rounded-full bg-gray-400" />
                    <span className="font-medium">{totalCount}</span>
                    <span className="text-gray-500">Servers</span>
                </span>

                <span className="text-gray-700">·</span>

                {/* Operational */}
                <span className={classNames('flex items-center gap-1.5', operational > 0 ? 'text-green-400' : 'text-gray-600')}>
                    <span className={classNames('h-2 w-2 rounded-full', operational > 0 ? 'bg-green-400' : 'bg-gray-700')} />
                    <span className="font-medium">{operational}</span>
                    <span className={operational > 0 ? 'text-green-600' : 'text-gray-700'}>Operational</span>
                </span>

                <span className="text-gray-700">·</span>

                {/* Suspended */}
                <span className={classNames('flex items-center gap-1.5', suspended > 0 ? 'text-yellow-400' : 'text-gray-700')}>
                    <span className={classNames('h-2 w-2 rounded-full', suspended > 0 ? 'bg-yellow-400' : 'bg-gray-800')} />
                    <span className="font-medium">{suspended}</span>
                    <span className={suspended > 0 ? 'text-yellow-600' : 'text-gray-700'}>Suspended</span>
                </span>

                <span className="text-gray-700">·</span>

                {/* Alerts */}
                <span className={classNames('flex items-center gap-1.5', alertCount > 0 ? 'text-red-400' : 'text-gray-700')}>
                    <span className={classNames('h-2 w-2 rounded-full', alertCount > 0 ? 'bg-red-400' : 'bg-gray-800')} />
                    <span className="font-medium">{alertCount}</span>
                    <span className={alertCount > 0 ? 'text-red-600' : 'text-gray-700'}>
                        {alertCount === 1 ? 'Alert' : 'Alerts'}
                    </span>
                </span>
            </div>
        </div>
    );
};
