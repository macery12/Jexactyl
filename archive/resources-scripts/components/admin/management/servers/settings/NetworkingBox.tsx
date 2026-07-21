import { faNetworkWired, faPlus, faTrash, faStar } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { useFormikContext } from 'formik';

import http from '@/api/http';
import { Allocation } from '@/api/routes/admin/nodes/getAllocations';
import { useServerFromRoute } from '@/api/routes/admin/server';
import updateServer, { Values } from '@/api/routes/admin/servers/updateServer';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { useStoreActions } from 'easy-peasy';
import { Dialog } from '@/elements/dialog';
import Label from '@/elements/Label';
import Spinner from '@/elements/Spinner';

export default () => {
    const { data: server, mutate } = useServerFromRoute();
    const { setFieldValue } = useFormikContext<Values>();
    const { clearFlashes, clearAndAddHttpError } = useStoreActions(actions => actions.flashes);
    const [availableAllocations, setAvailableAllocations] = useState<Allocation[]>([]);
    const [selectedAvailableId, setSelectedAvailableId] = useState<number | null>(null);
    const [selectedCurrentId, setSelectedCurrentId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingAvailable, setLoadingAvailable] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    // Sync the server's current primary allocation ID with the Formik form
    useEffect(() => {
        if (server) {
            setFieldValue('allocationId', server.allocationId);
        }
    }, [server?.allocationId, setFieldValue]);

    // Load available allocations when modal opens
    useEffect(() => {
        if (!server || !modalOpen) return;

        const fetchAllAllocations = async () => {
            setLoadingAvailable(true);
            try {
                const allAllocations: Allocation[] = [];
                let currentPage = 1;
                let totalPages = 1;

                // Fetch all pages
                do {
                    const response = await http.get(`/api/application/nodes/${server.nodeId}/allocations`, {
                        params: {
                            'filter[server_id]': '0',
                            page: currentPage,
                        },
                    });

                    const allocations = (response.data.data || []).map((item: any) => ({
                        id: item.attributes.id,
                        ip: item.attributes.ip,
                        port: item.attributes.port,
                        alias: item.attributes.alias || null,
                        serverId: item.attributes.server_id,
                        assigned: item.attributes.assigned,
                        relations: {},
                        getDisplayText(): string {
                            if (item.attributes.alias !== null) {
                                return `${item.attributes.ip}:${item.attributes.port} (${item.attributes.alias})`;
                            }
                            return `${item.attributes.ip}:${item.attributes.port}`;
                        },
                    }));

                    allAllocations.push(...allocations);

                    // Get pagination info
                    if (response.data.meta?.pagination) {
                        totalPages = response.data.meta.pagination.total_pages;
                    }

                    currentPage++;
                } while (currentPage <= totalPages);

                setAvailableAllocations(allAllocations);
            } catch (error) {
                console.error('Failed to load allocations:', error);
            } finally {
                setLoadingAvailable(false);
            }
        };

        fetchAllAllocations();
    }, [server, modalOpen]);

    if (!server) return null;

    const currentAllocations = server.relationships.allocations || [];
    const allocationLimit = server.featureLimits?.allocations || 0;
    const canAddMore = allocationLimit === 0 || currentAllocations.length < allocationLimit;

    const handleAddAllocation = async () => {
        if (!selectedAvailableId) return;

        // Check allocation limit before adding
        if (!canAddMore) {
            clearAndAddHttpError({
                key: 'server:networking',
                error: {
                    message: `Allocation limit of ${allocationLimit} reached. Remove allocations or increase the limit.`,
                },
            });
            return;
        }

        setLoading(true);
        clearFlashes('server:networking');

        try {
            await updateServer(server.id, {
                externalId: server.externalId || '',
                name: server.name,
                ownerId: server.ownerId,
                limits: {
                    memory: server.limits.memory,
                    swap: server.limits.swap,
                    disk: server.limits.disk,
                    io: server.limits.io,
                    cpu: server.limits.cpu,
                    threads: server.limits.threads || '',
                    oomKiller: server.limits.oomKiller,
                },
                featureLimits: {
                    allocations: server.featureLimits.allocations,
                    backups: server.featureLimits.backups,
                    databases: server.featureLimits.databases,
                    subusers: server.featureLimits.subusers,
                    subdomains: server.featureLimits.subdomains,
                },
                allocationId: server.allocationId,
                addAllocations: [selectedAvailableId],
                removeAllocations: [],
            });

            await mutate();
            setSelectedAvailableId(null);
        } catch (error) {
            console.error('Failed to add allocation:', error);
            clearAndAddHttpError({ key: 'server:networking', error });
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveAllocation = async () => {
        if (!selectedCurrentId) return;

        // Can't remove the primary allocation if there are no other allocations
        const isPrimarySelected = selectedCurrentId === server.allocationId;
        const remainingCount = currentAllocations.length - 1;

        if (isPrimarySelected && remainingCount === 0) {
            clearAndAddHttpError({
                key: 'server:networking',
                error: {
                    message:
                        'Cannot remove the primary allocation without other allocations. Add another allocation first.',
                },
            });
            return;
        }

        setLoading(true);
        clearFlashes('server:networking');

        try {
            // If removing primary, set a new primary first
            let newPrimaryId = server.allocationId;
            if (selectedCurrentId === server.allocationId) {
                const remaining = currentAllocations.find(a => a.id !== selectedCurrentId);
                if (remaining) {
                    newPrimaryId = remaining.id;
                }
            }

            await updateServer(server.id, {
                externalId: server.externalId || '',
                name: server.name,
                ownerId: server.ownerId,
                limits: {
                    memory: server.limits.memory,
                    swap: server.limits.swap,
                    disk: server.limits.disk,
                    io: server.limits.io,
                    cpu: server.limits.cpu,
                    threads: server.limits.threads || '',
                    oomKiller: server.limits.oomKiller,
                },
                featureLimits: {
                    allocations: server.featureLimits.allocations,
                    backups: server.featureLimits.backups,
                    databases: server.featureLimits.databases,
                    subusers: server.featureLimits.subusers,
                    subdomains: server.featureLimits.subdomains,
                },
                allocationId: newPrimaryId,
                addAllocations: [],
                removeAllocations: [selectedCurrentId],
            });

            await mutate();
            setSelectedCurrentId(null);
        } catch (error) {
            console.error('Failed to remove allocation:', error);
            clearAndAddHttpError({ key: 'server:networking', error });
        } finally {
            setLoading(false);
        }
    };

    const handleSetPrimary = async () => {
        if (!selectedCurrentId || selectedCurrentId === server.allocationId) return;

        setLoading(true);
        clearFlashes('server:networking');

        try {
            await updateServer(server.id, {
                externalId: server.externalId || '',
                name: server.name,
                ownerId: server.ownerId,
                limits: {
                    memory: server.limits.memory,
                    swap: server.limits.swap,
                    disk: server.limits.disk,
                    io: server.limits.io,
                    cpu: server.limits.cpu,
                    threads: server.limits.threads || '',
                    oomKiller: server.limits.oomKiller,
                },
                featureLimits: {
                    allocations: server.featureLimits.allocations,
                    backups: server.featureLimits.backups,
                    databases: server.featureLimits.databases,
                    subusers: server.featureLimits.subusers,
                    subdomains: server.featureLimits.subdomains,
                },
                allocationId: selectedCurrentId,
                addAllocations: [],
                removeAllocations: [],
            });

            await mutate();
        } catch (error) {
            console.error('Failed to set primary allocation:', error);
            clearAndAddHttpError({ key: 'server:networking', error });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <AdminBox icon={faNetworkWired} title={'Networking'}>
                <div css={tw`space-y-4`}>
                    {/* Current allocations summary */}
                    <div>
                        <Label>Current Allocations</Label>
                        <div css={tw`mt-2 space-y-2`}>
                            {currentAllocations.length === 0 ? (
                                <p css={tw`text-sm text-gray-400`}>No allocations assigned.</p>
                            ) : (
                                currentAllocations.map(allocation => (
                                    <div key={allocation.id} css={tw`flex items-center gap-2 text-sm`}>
                                        <span css={tw`font-mono`}>{allocation.getDisplayText()}</span>
                                        {allocation.id === server.allocationId && (
                                            <span
                                                css={tw`text-xs bg-blue-500 px-2 py-0.5 rounded flex items-center gap-1`}
                                            >
                                                <FontAwesomeIcon icon={faStar} css={tw`text-xs`} />
                                                Primary
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                        {allocationLimit > 0 && (
                            <p css={tw`text-xs text-gray-400 mt-2`}>
                                {currentAllocations.length} / {allocationLimit} allocations used
                            </p>
                        )}
                    </div>

                    {/* Button to open modal */}
                    <Button type="button" onClick={() => setModalOpen(true)}>
                        <FontAwesomeIcon icon={faNetworkWired} css={tw`mr-2`} />
                        Manage Allocations
                    </Button>
                </div>
            </AdminBox>

            {/* Allocation Management Modal */}
            <Dialog
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Manage Server Allocations"
                description="Add, remove, or set primary allocations for this server"
                size="xl"
            >
                <Dialog.Icon position="top" type={'info'} />
                <div css={tw`mt-4`}>
                    <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-6`}>
                        {/* Current Allocations */}
                        <div>
                            <div css={tw`flex items-center justify-between mb-2`}>
                                <Label>Current Allocations</Label>
                                <div css={tw`flex gap-2`}>
                                    <Button
                                        type="button"
                                        onClick={handleSetPrimary}
                                        disabled={
                                            !selectedCurrentId || selectedCurrentId === server.allocationId || loading
                                        }
                                        css={tw`text-xs px-2 py-1`}
                                    >
                                        <FontAwesomeIcon icon={faStar} css={tw`mr-1`} />
                                        Set Primary
                                    </Button>
                                    <Button
                                        type="button"
                                        onClick={handleRemoveAllocation}
                                        disabled={!selectedCurrentId || loading}
                                        css={tw`text-xs px-2 py-1 bg-red-600 hover:bg-red-700`}
                                    >
                                        <FontAwesomeIcon icon={faTrash} css={tw`mr-1`} />
                                        Remove
                                    </Button>
                                </div>
                            </div>

                            <div css={tw`border border-gray-600 rounded overflow-hidden min-h-[200px] max-h-[400px]`}>
                                {currentAllocations.length === 0 ? (
                                    <div css={tw`p-4 text-center text-gray-400 text-sm`}>
                                        No allocations assigned. Add allocations from the right.
                                    </div>
                                ) : (
                                    <div css={tw`divide-y divide-gray-600 max-h-[400px] overflow-y-auto`}>
                                        {currentAllocations.map(allocation => (
                                            <div
                                                key={allocation.id}
                                                onClick={() =>
                                                    setSelectedCurrentId(prev =>
                                                        prev === allocation.id ? null : allocation.id,
                                                    )
                                                }
                                                css={tw`flex items-center justify-between p-3 cursor-pointer transition-colors hover:bg-gray-700`}
                                                style={{
                                                    backgroundColor:
                                                        selectedCurrentId === allocation.id ? '#374151' : undefined,
                                                }}
                                            >
                                                <div css={tw`flex items-center gap-3`}>
                                                    <input
                                                        type="radio"
                                                        checked={selectedCurrentId === allocation.id}
                                                        onChange={() => setSelectedCurrentId(allocation.id)}
                                                        css={tw`cursor-pointer`}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                    <span css={tw`font-mono text-sm`}>
                                                        {allocation.getDisplayText()}
                                                    </span>
                                                    {allocation.id === server.allocationId && (
                                                        <span
                                                            css={tw`text-xs bg-blue-500 px-2 py-0.5 rounded flex items-center gap-1`}
                                                        >
                                                            <FontAwesomeIcon icon={faStar} css={tw`text-xs`} />
                                                            Primary
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Available Allocations */}
                        <div>
                            <div css={tw`flex items-center justify-between mb-2`}>
                                <Label>Available Allocations</Label>
                                <Button
                                    type="button"
                                    onClick={handleAddAllocation}
                                    disabled={!selectedAvailableId || !canAddMore || loading}
                                    css={tw`text-xs px-2 py-1`}
                                >
                                    <FontAwesomeIcon icon={faPlus} css={tw`mr-1`} />
                                    Add Selected
                                </Button>
                            </div>

                            <div
                                css={tw`border border-gray-600 rounded overflow-hidden min-h-[200px] max-h-[400px] overflow-y-auto`}
                            >
                                {loadingAvailable ? (
                                    <div css={tw`p-4 flex items-center justify-center`}>
                                        <Spinner size="small" />
                                    </div>
                                ) : availableAllocations.length === 0 ? (
                                    <div css={tw`p-4 text-center text-gray-400 text-sm`}>
                                        No available allocations on this node.
                                    </div>
                                ) : (
                                    <div css={tw`divide-y divide-gray-600`}>
                                        {availableAllocations.map(allocation => (
                                            <div
                                                key={allocation.id}
                                                onClick={() =>
                                                    setSelectedAvailableId(prev =>
                                                        prev === allocation.id ? null : allocation.id,
                                                    )
                                                }
                                                css={tw`flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-gray-700`}
                                                style={{
                                                    backgroundColor:
                                                        selectedAvailableId === allocation.id ? '#374151' : undefined,
                                                }}
                                            >
                                                <input
                                                    type="radio"
                                                    checked={selectedAvailableId === allocation.id}
                                                    onChange={() => setSelectedAvailableId(allocation.id)}
                                                    css={tw`cursor-pointer`}
                                                    onClick={e => e.stopPropagation()}
                                                />
                                                <span css={tw`font-mono text-sm`}>{allocation.getDisplayText()}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {!canAddMore && allocationLimit > 0 && (
                                <p css={tw`text-xs text-yellow-400 mt-2`}>
                                    Allocation limit reached. Remove allocations or increase the limit.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Info Message */}
                    <div css={tw`text-xs text-gray-400 bg-gray-800 p-3 rounded mt-4`}>
                        <p>
                            💡 <strong>How to use:</strong> Select an allocation from either list. Click &quot;Add&quot;
                            to add the selected available allocation, or &quot;Remove&quot; to remove the selected
                            current allocation. Select a current allocation and click &quot;Set Primary&quot; to make it
                            the primary allocation. Changes are saved automatically.
                        </p>
                    </div>
                </div>
            </Dialog>
        </>
    );
};
