import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { useServerFromRoute } from '@/api/routes/admin/server';
import AdminBox from '@/elements/AdminBox';
import { useStoreState } from '@/state/hooks';
import { faServer, faLayerGroup, faBalanceScale, faCashRegister, faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Spinner from '@/elements/Spinner';
import getNode from '@/api/routes/admin/nodes/getNode';
import { Node } from '@/api/routes/admin/nodes/getNodes';
import NodeStatus from '@admin/management/nodes/NodeStatus';
import { NavLink } from 'react-router-dom';
import useFlash from '@/plugins/useFlash';

// Status badge colors
const STATUS_COLORS = {
    active: { backgroundColor: '#10b98133', color: '#10b981' },
    running: { backgroundColor: '#10b98133', color: '#10b981' },
    default: { backgroundColor: '#ef444433', color: '#ef4444' },
};

const getStatusColors = (status: string | null) => {
    // Null or undefined status means active server
    if (!status) {
        return STATUS_COLORS.active;
    }
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.default;
};

export default () => {
    const [node, setNode] = useState<Node | undefined>();
    const { data: server } = useServerFromRoute();
    const { billing } = useStoreState(state => state.everest.data!);
    const { addFlash } = useFlash();

    useEffect(() => {
        if (server) {
            getNode(server.nodeId).then(node => setNode(node));
        }
    }, [server?.nodeId]);

    if (!server) return null;

    const product = server.relationships.product;
    const primaryAllocation = server.relationships.allocations[0];

    const copyToClipboard = (text: string) => {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                addFlash({ type: 'success', message: 'UUID copied to clipboard!' });
            })
            .catch(() => {
                addFlash({ type: 'error', message: 'Failed to copy UUID to clipboard' });
            });
    };

    return (
        <div css={tw`space-y-6`}>
            {/* Row 1: Three asymmetric cards (4/5/3 column distribution) */}
            <div css={tw`grid grid-cols-1 md:grid-cols-12 gap-4`}>
                {/* Server Status Card - 4 columns */}
                <div css={tw`md:col-span-4`}>
                    <AdminBox icon={faServer} title={'Server Status'}>
                        <div css={tw`space-y-5 min-h-[160px]`}>
                            {/* Primary: Server Status - Visually prominent */}
                            <div css={tw`flex items-center gap-2`}>
                                <span
                                    css={tw`px-3 py-1 rounded-full text-sm font-semibold capitalize`}
                                    style={getStatusColors(server.status)}
                                >
                                    {server.status ?? 'Active'}
                                </span>
                            </div>

                            {/* Secondary: Owner and Server ID - Compact two-column grid */}
                            <div css={tw`pt-2 border-t border-gray-700 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs`}>
                                <span css={tw`text-gray-500`}>Owner</span>
                                <span css={tw`text-gray-300 text-right truncate`}>
                                    {server.relationships.user?.username || 'Unknown'}
                                </span>
                                <span css={tw`text-gray-500`}>Server ID</span>
                                <div
                                    css={tw`flex items-center gap-1 justify-end cursor-pointer hover:text-blue-400 transition-colors`}
                                    onClick={() => copyToClipboard(server.uuid)}
                                    title="Click to copy"
                                >
                                    <span css={tw`text-gray-400 font-mono truncate max-w-[120px]`}>{server.uuid}</span>
                                    <FontAwesomeIcon icon={faCopy} css={tw`text-gray-500 flex-shrink-0`} />
                                </div>
                            </div>
                        </div>
                    </AdminBox>
                </div>

                {/* Resource Limits Card - 5 columns */}
                <div css={tw`md:col-span-5`}>
                    <AdminBox icon={faBalanceScale} title={'Resource Limits'}>
                        <div css={tw`space-y-4 min-h-[160px]`}>
                            {/* Primary: Large numbers for main resources with more spacing */}
                            <div css={tw`grid grid-cols-1 sm:grid-cols-3 gap-4`}>
                                <div css={tw`text-center`}>
                                    <div css={tw`text-2xl font-bold text-blue-400`}>
                                        {server.limits.cpu === 0 ? '∞' : server.limits.cpu}
                                    </div>
                                    <div css={tw`text-xs text-gray-400 mt-1`}>CPU</div>
                                    <div css={tw`text-xs text-gray-500`}>
                                        {server.limits.cpu === 0 ? 'Unlimited' : '%'}
                                    </div>
                                </div>
                                <div css={tw`text-center`}>
                                    <div css={tw`text-2xl font-bold text-green-400`}>
                                        {server.limits.memory === 0 ? '∞' : server.limits.memory}
                                    </div>
                                    <div css={tw`text-xs text-gray-400 mt-1`}>Memory</div>
                                    <div css={tw`text-xs text-gray-500`}>
                                        {server.limits.memory === 0 ? 'Unlimited' : 'MiB'}
                                    </div>
                                </div>
                                <div css={tw`text-center`}>
                                    <div css={tw`text-2xl font-bold text-purple-400`}>
                                        {server.limits.disk === 0 ? '∞' : server.limits.disk}
                                    </div>
                                    <div css={tw`text-xs text-gray-400 mt-1`}>Disk</div>
                                    <div css={tw`text-xs text-gray-500`}>
                                        {server.limits.disk === 0 ? 'Unlimited' : 'MiB'}
                                    </div>
                                </div>
                            </div>

                            {/* Tertiary: Darker muted footer for secondary info */}
                            <div
                                css={tw`-mx-4 -mb-4 px-4 py-3 bg-gray-800 bg-opacity-50 rounded-b flex justify-center gap-6 text-xs border-t border-gray-700`}
                            >
                                <div css={tw`flex items-center gap-2`}>
                                    <span css={tw`text-gray-500`}>Swap:</span>
                                    <span css={tw`text-gray-400`}>
                                        {server.limits.swap === 0 ? '∞' : `${server.limits.swap}`}
                                    </span>
                                </div>
                                <div css={tw`flex items-center gap-2`}>
                                    <span css={tw`text-gray-500`}>I/O:</span>
                                    <span css={tw`text-gray-400`}>
                                        {server.limits.io === 0 ? '∞' : server.limits.io}
                                    </span>
                                </div>
                                <div css={tw`flex items-center gap-2`} title="Out of Memory Killer">
                                    <span css={tw`text-gray-500`}>OOM Killer:</span>
                                    <span css={tw`text-gray-400`}>
                                        {server.limits.oomKiller ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </AdminBox>
                </div>

                {/* Billing Summary Card - 3 columns */}
                <div css={tw`md:col-span-3`}>
                    <AdminBox icon={faCashRegister} title={'Billing Summary'}>
                        <div css={tw`space-y-4 min-h-[160px]`}>
                            {billing.enabled && server.billingProductId && product ? (
                                <>
                                    {/* Primary: Plan and Cost */}
                                    <div>
                                        <div css={tw`text-base font-semibold text-gray-200 truncate`}>
                                            {product.name}
                                        </div>
                                        <div css={tw`text-xl font-bold text-green-400 mt-1`}>
                                            {billing.currency.symbol}
                                            {product.price}
                                            <span css={tw`text-xs text-gray-400 ml-1`}>
                                                {billing.currency.code.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Secondary: Billing details */}
                                    <div css={tw`space-y-1.5 pt-2 border-t border-gray-700 text-xs`}>
                                        <div css={tw`flex justify-between items-center`}>
                                            <span css={tw`text-gray-500`}>Cycle</span>
                                            <span css={tw`text-gray-300`}>
                                                {server.billingDays ? `${server.billingDays}d` : '30d'}
                                            </span>
                                        </div>
                                        {server.renewalDate && (
                                            <div css={tw`flex justify-between items-center`}>
                                                <span css={tw`text-gray-500`}>Renewal</span>
                                                <span css={tw`font-medium text-blue-400`}>
                                                    {new Date(server.renewalDate).toLocaleDateString()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div css={tw`flex items-center justify-center h-full`}>
                                    <span css={tw`text-gray-400 text-sm`}>Billing Disabled</span>
                                </div>
                            )}
                        </div>
                    </AdminBox>
                </div>
            </div>

            {/* Row 2: Node & Network - Full width card with increased padding */}
            <div css={tw`grid grid-cols-1`}>
                <AdminBox icon={faLayerGroup} title={'Node & Network'}>
                    <div css={tw`grid grid-cols-1 md:grid-cols-3 gap-4 py-2`}>
                        {/* Primary: Node name with health indicator */}
                        <div css={tw`md:col-span-2`}>
                            <div css={tw`text-sm text-gray-500 mb-2`}>Node</div>
                            {!node ? (
                                <Spinner size={'small'} />
                            ) : (
                                <NavLink
                                    to={`/admin/nodes/${node.id}`}
                                    css={tw`flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors`}
                                >
                                    <span css={tw`font-medium text-base`}>{node.name}</span>
                                    <span css={tw`text-gray-500`}>&bull;</span>
                                    <span css={tw`text-sm text-gray-400`}>
                                        {node.scheme}://{node.fqdn}
                                    </span>
                                    <NodeStatus node={node.id} />
                                </NavLink>
                            )}
                        </div>

                        {/* Secondary: Allocation count */}
                        <div css={tw`md:col-span-1`}>
                            <div css={tw`text-sm text-gray-500 mb-2`}>Total Allocations</div>
                            <div css={tw`text-base text-gray-300`}>
                                {server.relationships.allocations?.length || 0}
                                {server.featureLimits.allocations > 0 && (
                                    <span css={tw`text-gray-500`}> / {server.featureLimits.allocations}</span>
                                )}
                            </div>
                        </div>

                        {/* Primary allocation with copy action */}
                        <div css={tw`md:col-span-3 pt-3 border-t border-gray-700`}>
                            <div css={tw`text-sm text-gray-500 mb-2`}>Primary Allocation</div>
                            <div
                                css={tw`inline-flex items-center gap-2 cursor-pointer hover:text-blue-400 transition-colors`}
                                onClick={() => primaryAllocation && copyToClipboard(primaryAllocation.getDisplayText())}
                                title="Click to copy"
                            >
                                <span css={tw`font-mono text-base text-gray-300`}>
                                    {primaryAllocation?.getDisplayText() || 'None'}
                                </span>
                                {primaryAllocation && <FontAwesomeIcon icon={faCopy} css={tw`text-sm text-gray-500`} />}
                            </div>
                        </div>
                    </div>
                </AdminBox>
            </div>
        </div>
    );
};
