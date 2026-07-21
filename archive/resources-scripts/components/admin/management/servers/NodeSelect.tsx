import { useFormikContext } from 'formik';
import { useEffect, useState } from 'react';
import classNames from 'classnames';

import type { Node } from '@/api/routes/admin/node';
import { searchNodes } from '@/api/routes/admin/node';
import Label from '@/elements/Label';
import Spinner from '@/elements/Spinner';
import { Alert } from '@/elements/alert';
import { useStoreState } from '@/state/hooks';

export const fetchAllNodes = () => searchNodes({ filters: {} });

export default ({ node, setNode }: { node: Node | null; setNode: (_: Node | null) => void }) => {
    const { setFieldValue } = useFormikContext();
    const { colors } = useStoreState(state => state.theme.data!);

    const [nodes, setNodes] = useState<Node[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        fetchAllNodes()
            .then(setNodes)
            .catch(() => setError('Unable to load nodes. Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    const onSelect = (selected: Node) => {
        if (node?.id === selected.id) {
            setNode(null);
            setFieldValue('nodeId', null);
            return;
        }

        setNode(selected);
        setFieldValue('nodeId', selected.id);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <Label>Node</Label>
                {node && <span className="text-xs text-primary-300 bg-primary-500/10 px-2 py-1 rounded">Selected</span>}
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-24">
                    <Spinner size={'small'} />
                </div>
            ) : error ? (
                <Alert type={'danger'}>{error}</Alert>
            ) : nodes.length === 0 ? (
                <Alert type={'warning'}>No nodes available. Create a node first.</Alert>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {nodes.map(n => {
                        const isSelected = node?.id === n.id;

                        return (
                            <button
                                key={n.id}
                                type="button"
                                className={classNames(
                                    'w-full rounded-lg border text-left transition-colors duration-150 p-3',
                                    'hover:-translate-y-0.5 hover:shadow-sm',
                                )}
                                style={{
                                    backgroundColor: isSelected ? `${colors.primary}20` : colors.secondary,
                                    borderColor: isSelected ? colors.primary : colors.headers,
                                }}
                                onClick={() => onSelect(n)}
                                aria-label={`Select node ${n.name} (${n.fqdn})`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold text-sm text-neutral-100">{n.name}</p>
                                        <p className="text-[11px] text-neutral-400 break-all">{n.fqdn}</p>
                                    </div>
                                    {isSelected && (
                                        <span
                                            className="text-[11px] px-2 py-0.5 rounded font-medium"
                                            style={{
                                                backgroundColor: `${colors.primary}20`,
                                                color: colors.primary,
                                            }}
                                        >
                                            Selected
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-300">
                                    <span className="rounded bg-neutral-700/60 px-2 py-1">
                                        HTTP {n.ports.http.public}
                                    </span>
                                    <span className="rounded bg-neutral-700/60 px-2 py-1">
                                        SFTP {n.ports.sftp.public}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
