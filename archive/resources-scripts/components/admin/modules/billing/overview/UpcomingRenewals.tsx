import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { BillingAnalytics } from '@definitions/admin';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt, faCoins } from '@fortawesome/free-solid-svg-icons';

interface UpcomingRenewalsProps {
    data: BillingAnalytics;
}

export default ({ data }: UpcomingRenewalsProps) => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const currencySymbol = settings.currency.symbol;

    const overdueRenewals = data.upcomingRenewals?.overdue || { count: 0, expectedRevenue: 0 };
    const renewals7Days = data.upcomingRenewals?.in7Days || { count: 0, expectedRevenue: 0 };
    const renewals8to14Days = data.upcomingRenewals?.in8to14Days || { count: 0, expectedRevenue: 0 };
    const renewalsTotal14Days = data.upcomingRenewals?.total14Days || { count: 0, expectedRevenue: 0 };

    const hasRenewals = renewalsTotal14Days.count > 0;

    return (
        <ContentBox title="Upcoming Renewals" className="min-h-[200px]">
            {hasRenewals ? (
                <div className="space-y-4">
                    {/* Overdue Renewals - Show only if there are any */}
                    {overdueRenewals.count > 0 && (
                        <div className="rounded border border-red-500/20 bg-red-500/10 p-4">
                            <div className="mb-2 flex items-center gap-2">
                                <FontAwesomeIcon icon={faCalendarAlt} className="text-red-400" />
                                <h3 className="text-sm font-medium text-gray-300">Overdue (Past Due)</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                                <div>
                                    <p className="text-xs text-gray-500">Servers</p>
                                    <p className="text-2xl font-bold text-red-400">{overdueRenewals.count}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500">Expected Revenue</p>
                                    <p className="text-2xl font-bold text-green-400">
                                        {currencySymbol}
                                        {overdueRenewals.expectedRevenue.toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Next 7 Days */}
                    <div className="rounded border border-blue-500/20 bg-blue-500/10 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <FontAwesomeIcon icon={faCalendarAlt} className="text-blue-400" />
                            <h3 className="text-sm font-medium text-gray-300">Next 7 Days</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                            <div>
                                <p className="text-xs text-gray-500">Servers</p>
                                <p className="text-2xl font-bold text-blue-400">{renewals7Days.count}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Expected Revenue</p>
                                <p className="text-2xl font-bold text-green-400">
                                    {currencySymbol}
                                    {renewals7Days.expectedRevenue.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Days 8-14 */}
                    <div className="rounded border border-purple-500/20 bg-purple-500/10 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <FontAwesomeIcon icon={faCalendarAlt} className="text-purple-400" />
                            <h3 className="text-sm font-medium text-gray-300">Days 8-14</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                            <div>
                                <p className="text-xs text-gray-500">Servers</p>
                                <p className="text-2xl font-bold text-purple-400">{renewals8to14Days.count}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Expected Revenue</p>
                                <p className="text-2xl font-bold text-green-400">
                                    {currencySymbol}
                                    {renewals8to14Days.expectedRevenue.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Total Expected Revenue */}
                    <div className="flex items-center justify-between rounded bg-gray-800/50 p-3">
                        <div className="flex items-center gap-2">
                            <FontAwesomeIcon icon={faCoins} className="text-yellow-400" />
                            <span className="text-sm text-gray-400">Total (all periods)</span>
                        </div>
                        <span className="text-lg font-bold text-green-400">
                            {currencySymbol}
                            {renewalsTotal14Days.expectedRevenue.toFixed(2)}
                        </span>
                    </div>
                </div>
            ) : (
                <div className="flex h-full items-center justify-center py-8 text-center">
                    <div>
                        <FontAwesomeIcon icon={faCalendarAlt} className="mb-3 text-4xl text-gray-600" />
                        <p className="text-sm text-gray-500">No renewals scheduled in the next 14 days.</p>
                    </div>
                </div>
            )}
        </ContentBox>
    );
};
