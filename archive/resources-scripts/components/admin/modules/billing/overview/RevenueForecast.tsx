import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { BillingAnalytics } from '@definitions/admin';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import Tooltip from '@/elements/tooltip/Tooltip';

interface RevenueForecastProps {
    data: BillingAnalytics;
}

export default ({ data }: RevenueForecastProps) => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const currencySymbol = settings.currency.symbol;

    const forecast7Days = data.forecast?.next7Days || 0;
    const forecast30Days = data.forecast?.next30Days || 0;

    return (
        <ContentBox title="Revenue Forecast" className="min-h-[200px]">
            <div className="mb-3 flex items-center gap-2">
                <FontAwesomeIcon icon={faInfoCircle} className="text-blue-400" />
                <p className="text-xs text-gray-500">Estimates based on active subscriptions and billing cycles</p>
            </div>

            <div className="space-y-4">
                {/* 7-Day Forecast */}
                <div className="rounded border border-blue-500/20 bg-blue-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <FontAwesomeIcon icon={faChartLine} className="text-blue-400" />
                        <h3 className="text-sm font-medium text-gray-300">Next 7 Days</h3>
                        <Tooltip content="Estimated revenue from active subscriptions over the next 7 days">
                            <FontAwesomeIcon icon={faInfoCircle} className="text-xs text-gray-500" />
                        </Tooltip>
                    </div>
                    <p className="text-3xl font-bold text-blue-400">
                        {currencySymbol}
                        {forecast7Days.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">Estimate</p>
                </div>

                {/* 30-Day Forecast */}
                <div className="rounded border border-green-500/20 bg-green-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <FontAwesomeIcon icon={faChartLine} className="text-green-400" />
                        <h3 className="text-sm font-medium text-gray-300">Next 30 Days</h3>
                        <Tooltip content="Estimated revenue from active subscriptions over the next 30 days">
                            <FontAwesomeIcon icon={faInfoCircle} className="text-xs text-gray-500" />
                        </Tooltip>
                    </div>
                    <p className="text-3xl font-bold text-green-400">
                        {currencySymbol}
                        {forecast30Days.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">Estimate</p>
                </div>
            </div>
        </ContentBox>
    );
};
