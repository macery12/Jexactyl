import { useEffect, useState } from 'react';
import Spinner from '@/elements/Spinner';
import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { differenceInDays, parseISO } from 'date-fns';
import RevenueChart from './RevenueChart';
import Select from '@/elements/Select';
import { getBillingAnalytics } from '@/api/routes/admin/billing';
import { BillingAnalytics, Order } from '@definitions/admin';
import BillingHealthSummary from './BillingHealthSummary';
import UpcomingRenewals from './UpcomingRenewals';
import RevenueForecast from './RevenueForecast';
import RecentBillingEvents from './RecentBillingEvents';
import Tooltip from '@/elements/tooltip/Tooltip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';

export default () => {
    const now = new Date();
    const [history, setHistory] = useState<number>(14);
    const settings = useStoreState(s => s.everest.data!.billing);
    const [analytics, setAnalytics] = useState<BillingAnalytics>();

    useEffect(() => {
        getBillingAnalytics()
            .then(data => setAnalytics(data))
            .catch(error => console.error(error));
    }, []);

    if (!analytics || !analytics.orders) return <Spinner size={'large'} centered />;

    const successfulOrders: Order[] = analytics.orders.filter(
        x => x.status === 'processed' && differenceInDays(now, parseISO(x.created_at.toString())) <= history,
    );
    const allOrders: Order[] = analytics.orders.filter(
        x => differenceInDays(now, parseISO(x.created_at.toString())) <= history,
    );
    const successRate: string =
        allOrders.length > 0 ? ((successfulOrders.length / allOrders.length) * 100).toFixed(1) : '0.0';

    const failedOrders = analytics.orders.filter(
        x => x.status === 'failed' && differenceInDays(now, parseISO(x.created_at.toString())) <= history,
    );

    const revenueFromOrders = successfulOrders.reduce((total, order) => total + order.total, 0);
    const revenue: string = revenueFromOrders.toFixed(2);

    return (
        <div className={'space-y-6'}>
            {/* Header without date filter */}
            <div>
                <h2 className={'text-2xl font-medium text-neutral-50'}>Billing Dashboard</h2>
                <p className={'text-sm text-neutral-400'}>Monitor billing health, revenue, and upcoming renewals</p>
            </div>

            {/* Top row - Summary KPIs */}
            <div className={'grid gap-6 md:grid-cols-3'}>
                {/* Conversion Rate */}
                <ContentBox className={'min-h-[160px]'}>
                    <div className="flex items-start justify-between">
                        <h1 className={'text-xl font-bold text-neutral-300'}>Conversion Rate</h1>
                        <Tooltip content="Percentage of orders that were successfully processed">
                            <FontAwesomeIcon icon={faInfoCircle} className="text-gray-500" />
                        </Tooltip>
                    </div>
                    <div className="mt-2">
                        <div className="flex items-baseline gap-2">
                            <span className={'text-5xl font-bold text-green-400'}>{successRate}</span>
                            <span className={'text-2xl text-neutral-400'}>%</span>
                        </div>
                        <p className={'mt-3 text-sm text-gray-400'}>
                            Out of {allOrders.length} orders, {successfulOrders.length} were processed.
                        </p>
                    </div>
                </ContentBox>

                {/* Total Revenue */}
                <ContentBox className={'min-h-[160px]'}>
                    <h1 className={'text-xl font-bold text-neutral-300'}>Total Revenue</h1>
                    <div className="mt-2">
                        <div className="flex items-baseline gap-1">
                            <span className={'text-2xl text-neutral-400'}>{settings.currency.symbol}</span>
                            <span className={'text-5xl font-bold text-blue-400'}>{revenue}</span>
                        </div>
                        <p className={'mt-3 text-sm text-gray-400'}>
                            From {successfulOrders.length} orders over the last {history} days.
                        </p>
                    </div>
                </ContentBox>

                {/* Failed Payments */}
                <ContentBox className={'min-h-[160px] border-red-500/20 bg-red-500/5'}>
                    <div className="flex items-start justify-between">
                        <h1 className={'text-xl font-bold text-neutral-300'}>Failed Payments</h1>
                        <Tooltip content="Number of orders that failed to process">
                            <FontAwesomeIcon icon={faInfoCircle} className="text-gray-500" />
                        </Tooltip>
                    </div>
                    <div className="mt-2">
                        <span className={'text-5xl font-bold text-red-400'}>{failedOrders.length}</span>
                        <p className={'mt-3 text-sm text-gray-400'}>
                            Failed payments in the last {history} days require attention.
                        </p>
                    </div>
                </ContentBox>
            </div>

            {/* Main row - Revenue Chart + Billing Health */}
            <div className={'grid gap-6 lg:grid-cols-12'}>
                <div className={'lg:col-span-8'}>
                    <ContentBox>
                        {/* Date Range Selector positioned above chart */}
                        <div className="mb-4 flex items-center justify-between border-b border-gray-700 pb-3">
                            <h3 className="text-lg font-medium text-neutral-200">Revenue Over Time</h3>
                            <Select onChange={e => setHistory(Number(e.currentTarget.value))} className="w-40">
                                <option value={7}>Last 7 days</option>
                                <option selected value={14}>
                                    Last 14 days
                                </option>
                                <option value={30}>Last month</option>
                                <option value={60}>Last 2 months</option>
                                <option value={90}>Last 3 months</option>
                                <option value={180}>Last 6 months</option>
                                <option value={360}>Last year</option>
                            </Select>
                        </div>
                        <RevenueChart data={analytics} history={history} />
                    </ContentBox>
                </div>
                <div className={'lg:col-span-4'}>
                    <BillingHealthSummary data={analytics} history={history} />
                </div>
            </div>

            {/* Additional Metrics Row - Renewals and Forecast */}
            <div className={'grid gap-6 md:grid-cols-2'}>
                <UpcomingRenewals data={analytics} />
                <RevenueForecast data={analytics} />
            </div>

            {/* Bottom row - Recent Billing Events */}
            <RecentBillingEvents data={analytics} />
        </div>
    );
};
