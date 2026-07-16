import { useEffect, useState } from 'react';
import { ServerContext } from '@/state/server';
import TitledGreyBox from '@/elements/TitledGreyBox';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import useFlash from '@/plugins/useFlash';
import { changeEgg } from '@/api/routes/server/startup';
import { getProduct } from '@/api/routes/account/billing/products';
import { getEggInfo, type EggInfo } from '@/api/routes/account/billing/products';
import { getCategories } from '@/api/routes/account/billing/categories';
import { Alert } from '@/elements/alert';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { faPuzzlePiece } from '@fortawesome/free-solid-svg-icons';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';

export default () => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const currentEggId = ServerContext.useStoreState(state => state.server.data!.eggId);
    const billingProductId = ServerContext.useStoreState(state => state.server.data!.billingProductId);
    const serverStatus = ServerContext.useStoreState(state => state.status.value);
    const { colors } = useStoreState(state => state.theme.data!);

    const [loading, setLoading] = useState(true);
    const [changing, setChanging] = useState(false);
    const [selectedEggId, setSelectedEggId] = useState<number>(currentEggId);
    const [availableEggs, setAvailableEggs] = useState<EggInfo[]>([]);
    const [currentEgg, setCurrentEgg] = useState<EggInfo | null>(null);
    const [allowEggChanges, setAllowEggChanges] = useState<boolean>(true);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleteFiles, setDeleteFiles] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState('');

    const { clearFlashes, clearAndAddHttpError } = useFlash();

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Require at least a current egg to render meaningful data
                if (!currentEggId) {
                    setAllowEggChanges(false);
                    setLoading(false);
                    return;
                }

                // Always fetch current egg info for display
                const currentEggInfo = await getEggInfo(currentEggId);
                setCurrentEgg(currentEggInfo);

                // Default to only the current egg
                let allowedEggIds: number[] = [currentEggId];
                let canChangeEggs = true;

                // If the server has an associated product, respect its allowed eggs and toggle
                if (billingProductId) {
                    try {
                        const product = await getProduct(billingProductId);
                        allowedEggIds = product.allowedEggs || [product.eggId];
                        canChangeEggs = product.allowEggChanges;
                    } catch (error) {
                        // Fall back to category lookup below
                        console.warn('Unable to load billing product, falling back to category search', error);
                    }
                }

                // Fallback: find the category that includes this egg and use its allowed eggs
                if (allowedEggIds.length === 1 || !billingProductId) {
                    try {
                        const categories = await getCategories();
                        const category = categories.find(c => c.allowedEggs?.includes(currentEggId));
                        if (category) {
                            allowedEggIds = category.allowedEggs || allowedEggIds;
                            canChangeEggs = category.allowEggChanges ?? canChangeEggs;
                        }
                    } catch (error) {
                        console.warn('Unable to load categories for egg lookup', error);
                    }
                }

                // Remove duplicates and reuse the already-fetched current egg info
                const uniqueAllowedEggIds = Array.from(new Set(allowedEggIds));
                const eggInfos = await Promise.all(
                    uniqueAllowedEggIds.map(id =>
                        id === currentEggId ? Promise.resolve(currentEggInfo) : getEggInfo(id),
                    ),
                );
                setAvailableEggs(eggInfos);

                // Allow changes when permitted by config and there is more than one choice
                setAllowEggChanges(canChangeEggs && eggInfos.length > 1);
                setLoading(false);
            } catch (error) {
                console.error(error);
                setLoading(false);
                setAllowEggChanges(false);
            }
        };

        fetchData();
    }, [billingProductId, currentEggId]);

    const handleChangeEgg = () => {
        if (selectedEggId === currentEggId) {
            clearFlashes('server:settings:egg');
            clearAndAddHttpError({
                key: 'server:settings:egg',
                error: { message: 'You must select a different server type to continue.' },
            });
            return;
        }

        // If deleteFiles is checked, ensure DELETE confirmation is typed
        if (deleteFiles && confirmDelete !== 'DELETE') {
            clearFlashes('server:settings:egg');
            clearAndAddHttpError({
                key: 'server:settings:egg',
                error: { message: 'You must type DELETE to confirm file deletion.' },
            });
            return;
        }

        setChanging(true);
        clearFlashes('server:settings:egg');

        changeEgg(uuid, selectedEggId, deleteFiles)
            .then(() => {
                window.location.reload(); // Reload to refresh server data
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'server:settings:egg', error });
                setChanging(false);
                setConfirmOpen(false);
            });
    };

    const selectedEgg = availableEggs.find(e => e.id === selectedEggId);
    const isStopped = serverStatus === null || serverStatus === 'offline';
    const canChange = selectedEggId !== currentEggId && isStopped;

    if (loading) {
        return (
            <TitledGreyBox title={'Change Server Type'} icon={faPuzzlePiece}>
                <SpinnerOverlay visible={true} />
                <p css={tw`text-gray-400 text-sm`}>Loading server type options...</p>
            </TitledGreyBox>
        );
    }

    if (!allowEggChanges || availableEggs.length <= 1) {
        return null;
    }

    return (
        <>
            <TitledGreyBox title={'Change Server Type'} icon={faPuzzlePiece}>
                <SpinnerOverlay visible={loading} />
                <div css={tw`mb-3`}>
                    <Label>Current Type</Label>
                    <p css={tw`text-gray-300 text-sm font-medium`}>{currentEgg?.name || 'Loading...'}</p>
                </div>

                <div css={tw`mb-3`}>
                    <Label>Select New Type</Label>
                    <Select value={selectedEggId} onChange={e => setSelectedEggId(Number(e.currentTarget.value))}>
                        {availableEggs.map(egg => (
                            <option key={egg.id} value={egg.id}>
                                {egg.name}
                            </option>
                        ))}
                    </Select>
                </div>

                {!isStopped && (
                    <Alert type={'warning'} className={'mb-3'}>
                        Server must be stopped first.
                    </Alert>
                )}

                {selectedEggId !== currentEggId && isStopped && (
                    <Alert type={'warning'} className={'mb-3'}>
                        <strong css={tw`text-yellow-400`}>⚠️ BACKUP YOUR FILES:</strong> This will reinstall your
                        server. While files are typically not deleted, corruption is always possible during
                        reinstallation. <strong>Always backup important data before proceeding.</strong>
                    </Alert>
                )}

                <Button.Danger onClick={() => setConfirmOpen(true)} disabled={!canChange || changing} css={tw`w-full`}>
                    {changing ? 'Changing...' : 'Change Type'}
                </Button.Danger>
            </TitledGreyBox>

            <Dialog.Confirm
                open={confirmOpen}
                title={'Confirm Server Type Change'}
                confirm={'Change Server Type'}
                onClose={() => {
                    setConfirmOpen(false);
                    setDeleteFiles(false);
                    setConfirmDelete('');
                    clearFlashes('server:settings:egg');
                }}
                onConfirmed={handleChangeEgg}
                buttonType={'danger'}
            >
                <FlashMessageRender byKey={'server:settings:egg'} css={tw`mb-3`} />
                <p css={tw`text-sm mb-3`}>
                    You are about to change your server type from <strong>{currentEgg?.name}</strong> to{' '}
                    <strong>{selectedEgg?.name}</strong>.
                </p>

                <div css={tw`bg-yellow-500/20 border border-yellow-500/50 rounded-md p-3 mb-3`}>
                    <p css={tw`text-sm font-bold text-yellow-300 mb-2`}>⚠️ IMPORTANT: BACKUP YOUR FILES</p>
                    <p css={tw`text-sm text-gray-300 mb-1`}>
                        The reinstallation process will run the installation script for the new server type.
                    </p>
                    <p css={tw`text-sm text-gray-300`}>
                        <strong>Files are normally NOT deleted</strong>, but corruption or modification is always
                        possible. Always backup your data before proceeding.
                    </p>
                </div>

                <div css={tw`bg-red-500/20 border border-red-500/50 rounded-md p-3 mb-3`}>
                    <label css={tw`flex items-start cursor-pointer`}>
                        <input
                            type="checkbox"
                            checked={deleteFiles}
                            onChange={e => {
                                setDeleteFiles(e.target.checked);
                                if (!e.target.checked) {
                                    setConfirmDelete('');
                                }
                            }}
                            css={tw`mt-1 mr-2`}
                        />
                        <div>
                            <p css={tw`text-sm font-bold text-red-300 mb-1`}>🗑️ Delete all files before reinstalling</p>
                            <p css={tw`text-xs text-gray-400`}>
                                This will permanently delete all server files, databases, and configurations before
                                installing the new server type.
                            </p>
                        </div>
                    </label>

                    {deleteFiles && (
                        <div css={tw`mt-3 pt-3 border-t border-red-500/30`}>
                            <p css={tw`text-xs font-bold text-red-300 mb-2`}>
                                ⚠️ CONFIRM FILE DELETION - Type DELETE to confirm:
                            </p>
                            <input
                                type="text"
                                value={confirmDelete}
                                onChange={e => setConfirmDelete(e.target.value.toUpperCase())}
                                placeholder="Type DELETE to confirm"
                                css={tw`w-full px-3 py-2 border border-red-500/50 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500`}
                                style={{ backgroundColor: colors.secondary }}
                                autoFocus
                            />
                            {confirmDelete && confirmDelete !== 'DELETE' && (
                                <p css={tw`text-xs text-red-400 mt-1`}>
                                    You must type DELETE exactly to confirm file deletion.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <p css={tw`text-sm text-gray-400`}>
                    {deleteFiles ? (
                        <>
                            The server will be stopped,{' '}
                            <strong css={tw`text-red-400`}>all files will be deleted</strong>, and then the new server
                            type will be installed. This action cannot be undone.
                        </>
                    ) : (
                        <>The server will be stopped and the new server type will be installed.</>
                    )}
                </p>
            </Dialog.Confirm>
        </>
    );
};
