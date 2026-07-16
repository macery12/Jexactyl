import React, { useEffect, useState } from 'react';
import { Order as AdminOrder } from '@definitions/admin/models';
import tw from 'twin.macro';
import { getOrderThreat, ThreatBreakdown, ThreatSignal } from '@/api/routes/admin/billing/orders';
import Spinner from '@/elements/Spinner';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldAlt, faExclamationTriangle, faCheckCircle, faSync } from '@fortawesome/free-solid-svg-icons';

interface Props {
    order: AdminOrder;
}

function getThreatColor(score: number): string {
    if (score >= 50) return 'text-red-400';
    if (score >= 25) return 'text-yellow-400';
    return 'text-green-400';
}

function getThreatLabel(score: number): string {
    if (score >= 50) return 'High Risk';
    if (score >= 25) return 'Medium Risk';
    return 'Low Risk';
}

function SignalRow({ signal, colors }: { signal: ThreatSignal; colors: any }) {
    const pct = signal.max_points > 0 ? Math.round((signal.points / signal.max_points) * 100) : 0;

    return (
        <div
            css={tw`rounded-lg p-4`}
            style={{ backgroundColor: colors.secondary }}
            className={signal.fired ? 'border-l-2 border-red-500/60' : 'border-l-2 border-neutral-700'}
        >
            <div css={tw`flex items-start justify-between gap-4`}>
                <div css={tw`flex items-start gap-3 flex-1 min-w-0`}>
                    <FontAwesomeIcon
                        icon={signal.fired ? faExclamationTriangle : faCheckCircle}
                        className={`mt-0.5 flex-shrink-0 ${signal.fired ? 'text-red-400' : 'text-green-500'}`}
                        size="sm"
                    />
                    <div css={tw`flex-1 min-w-0`}>
                        <p css={tw`text-sm font-medium text-white`}>{signal.category}</p>
                        <p css={tw`text-xs text-gray-400 mt-0.5`}>{signal.description}</p>
                    </div>
                </div>
                <div css={tw`flex-shrink-0 text-right`}>
                    <span className={`text-sm font-bold ${signal.fired ? 'text-red-400' : 'text-gray-500'}`}>
                        +{signal.points}
                    </span>
                    <span css={tw`text-xs text-gray-600`}>/{signal.max_points}</span>
                </div>
            </div>
            {signal.fired && signal.max_points > 0 && (
                <div css={tw`mt-2 ml-7`}>
                    <div css={tw`h-1 rounded-full bg-neutral-700 overflow-hidden`}>
                        <div
                            className={'h-full rounded-full bg-red-500/70 transition-all'}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

const OrderInspectorThreatTab: React.FC<Props> = ({ order }) => {
    const { colors } = useStoreState(state => state.theme.data!);
    const [breakdown, setBreakdown] = useState<ThreatBreakdown | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = () => {
        setLoading(true);
        setError(null);
        getOrderThreat(order.id)
            .then(data => setBreakdown(data))
            .catch(() => setError('Failed to load threat breakdown.'))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, [order.id]);

    if (loading) return <Spinner size={'large'} centered />;

    if (error || !breakdown) {
        return (
            <div css={tw`flex flex-col items-center justify-center py-12 text-center`}>
                <FontAwesomeIcon icon={faShieldAlt} css={tw`text-gray-600 mb-3`} size="3x" />
                <p css={tw`text-gray-400 text-sm`}>{error ?? 'No breakdown available.'}</p>
                <button
                    onClick={load}
                    css={tw`mt-4 text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1`}
                >
                    <FontAwesomeIcon icon={faSync} size="xs" /> Retry
                </button>
            </div>
        );
    }

    const fired = breakdown.signals.filter(s => s.fired);
    const clean = breakdown.signals.filter(s => !s.fired);

    return (
        <div css={tw`space-y-6`}>
            {/* Score summary */}
            <div css={tw`rounded-lg p-5`} style={{ backgroundColor: colors.secondary }}>
                <div css={tw`flex items-center justify-between`}>
                    <div>
                        <p css={tw`text-sm text-gray-400 mb-1`}>Computed Threat Score</p>
                        <div css={tw`flex items-baseline gap-2`}>
                            <span className={`text-5xl font-bold ${getThreatColor(breakdown.score)}`}>
                                {breakdown.score}
                            </span>
                            <span css={tw`text-xl text-gray-500`}>/100</span>
                        </div>
                        <p className={`text-sm font-medium mt-1 ${getThreatColor(breakdown.score)}`}>
                            {getThreatLabel(breakdown.score)}
                        </p>
                    </div>
                    <FontAwesomeIcon
                        icon={faShieldAlt}
                        className={`${getThreatColor(breakdown.score)} opacity-20`}
                        size="5x"
                    />
                </div>
                {/* Score bar */}
                <div css={tw`mt-4 h-2 rounded-full bg-neutral-700 overflow-hidden`}>
                    <div
                        className={`h-full rounded-full transition-all ${
                            breakdown.score >= 50
                                ? 'bg-red-500'
                                : breakdown.score >= 25
                                  ? 'bg-yellow-400'
                                  : 'bg-green-500'
                        }`}
                        style={{ width: `${breakdown.score}%` }}
                    />
                </div>
                <div css={tw`flex justify-between mt-1`}>
                    <span css={tw`text-xs text-gray-600`}>0 — Low risk</span>
                    <button
                        onClick={load}
                        css={tw`text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1`}
                    >
                        <FontAwesomeIcon icon={faSync} size="xs" /> Refresh
                    </button>
                    <span css={tw`text-xs text-gray-600`}>High risk — 100</span>
                </div>
            </div>

            {/* Fired signals */}
            {fired.length > 0 && (
                <div>
                    <h3 css={tw`text-sm font-semibold text-red-400 uppercase tracking-wide mb-3`}>
                        Risk Signals ({fired.length})
                    </h3>
                    <div css={tw`space-y-2`}>
                        {fired.map((signal, i) => (
                            <SignalRow key={i} signal={signal} colors={colors} />
                        ))}
                    </div>
                </div>
            )}

            {/* Clean signals */}
            {clean.length > 0 && (
                <div>
                    <h3 css={tw`text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3`}>
                        Passed Checks ({clean.length})
                    </h3>
                    <div css={tw`space-y-2`}>
                        {clean.map((signal, i) => (
                            <SignalRow key={i} signal={signal} colors={colors} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderInspectorThreatTab;
