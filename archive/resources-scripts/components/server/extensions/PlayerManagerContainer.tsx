import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ServerContext } from '@/state/server';
import {
    getPlayerManagerStatus,
    PlayerManagerStatus,
    setWhitelistEnabled,
    addToWhitelist,
    removeFromWhitelist,
    opPlayer,
    deopPlayer,
    banPlayer,
    unbanPlayer,
    banIp,
    unbanIp,
    kickPlayer,
    whisperPlayer,
    killPlayer,
    getServerVersion,
    ServerVersion,
} from '@/api/server/extensions/playerManager';
import Spinner from '@/elements/Spinner';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faUsers,
    faCircle,
    faUserShield,
    faListCheck,
    faBan,
    faSync,
    faCrown,
    faCommentDots,
    faSkull,
    faDoorOpen,
    faArrowLeft,
    faToggleOn,
    faToggleOff,
    faPlus,
    faTrash,
    faNetworkWired,
    faBox,
    faSlidersH,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import PageContentBlock from '@/elements/PageContentBlock';
import { Button } from '@/elements/button';
import Modal from '@/elements/Modal';
import Field from '@/elements/Field';
import { Form, Formik } from 'formik';
import { object, string, number } from 'yup';
import classNames from 'classnames';
import InventoryViewer from './InventoryViewer';
import AttributeEditor from './AttributeEditor';
import { usePermissions } from '@/plugins/usePermissions';

interface PlayerActionsModalProps {
    visible: boolean;
    onDismissed: () => void;
    player: string;
    serverUuid: string;
    onAction: () => void;
    supportsAttributes: boolean;
    onViewInventory: () => void;
    onEditAttributes: () => void;
    isOperator: boolean;
    isOnline: boolean;
    canManage: boolean;
}

const PlayerActionsModal = ({
    visible,
    onDismissed,
    player,
    serverUuid,
    onAction,
    supportsAttributes,
    onViewInventory,
    onEditAttributes,
    isOperator,
    isOnline,
    canManage,
}: PlayerActionsModalProps) => {
    const [loading, setLoading] = useState(false);
    const [, setActiveAction] = useState<string | null>(null);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    const handleAction = async (action: () => Promise<void>, actionName: string) => {
        setLoading(true);
        setActiveAction(actionName);
        clearFlashes('server:player-manager:modal');

        try {
            await action();
            addFlash({ key: 'server:player-manager', type: 'success', message: `Action completed: ${actionName}` });
            onAction();
            onDismissed();
        } catch (error) {
            clearAndAddHttpError({ key: 'server:player-manager:modal', error });
        } finally {
            setLoading(false);
            setActiveAction(null);
        }
    };

    return (
        <Modal visible={visible} onDismissed={onDismissed} closeOnBackground showSpinnerOverlay={loading}>
            <FlashMessageRender byKey={'server:player-manager:modal'} className={'mb-4'} />
            <h2 className={'mb-4 text-xl font-semibold text-white'}>Actions for {player}</h2>

            {!isOnline && (
                <div
                    className={'mb-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300'}
                >
                    This player is offline. Kick, Kill, and Attribute editing are unavailable.
                </div>
            )}
            {!canManage && (
                <div
                    className={
                        'mb-4 rounded-lg border border-neutral-600/40 bg-neutral-500/10 p-3 text-sm text-neutral-300'
                    }
                >
                    You have read-only access. Management actions are disabled.
                </div>
            )}

            {/* v1.0.1 - View Data Buttons */}
            <div className={'mb-4 grid gap-3 sm:grid-cols-2'}>
                <Button
                    onClick={() => {
                        onDismissed();
                        onViewInventory();
                    }}
                    className={'w-full justify-center'}
                    style={{ backgroundColor: `${primary}20`, borderColor: primary }}
                >
                    <FontAwesomeIcon icon={faBox} className={'mr-2'} />
                    View Inventory
                </Button>
                {supportsAttributes && (
                    <Button
                        onClick={() => {
                            onDismissed();
                            onEditAttributes();
                        }}
                        className={'w-full justify-center'}
                        style={{ backgroundColor: `${primary}20`, borderColor: primary }}
                        disabled={!isOnline || !canManage}
                        title={!isOnline ? 'Player is offline' : !canManage ? 'Read-only access' : undefined}
                    >
                        <FontAwesomeIcon icon={faSlidersH} className={'mr-2'} />
                        Edit Attributes
                    </Button>
                )}
            </div>

            <div className={'border-t border-neutral-700 pt-4 mb-4'}>
                <h3 className={'text-sm text-neutral-400 mb-3'}>Quick Actions</h3>
            </div>

            <div className={'grid gap-3 sm:grid-cols-2'}>
                <Button
                    onClick={() => handleAction(() => kickPlayer(serverUuid, player), 'Kick')}
                    className={'w-full justify-center'}
                    disabled={loading || !isOnline || !canManage}
                    title={!isOnline ? 'Player is offline' : !canManage ? 'Read-only access' : undefined}
                >
                    <FontAwesomeIcon icon={faDoorOpen} className={'mr-2'} />
                    Kick Player
                </Button>
                <Button
                    onClick={() => handleAction(() => killPlayer(serverUuid, player), 'Kill')}
                    className={'w-full justify-center'}
                    disabled={loading || !isOnline || !canManage}
                    title={!isOnline ? 'Player is offline' : !canManage ? 'Read-only access' : undefined}
                >
                    <FontAwesomeIcon icon={faSkull} className={'mr-2'} />
                    Kill Player
                </Button>
                <Button
                    onClick={() =>
                        handleAction(
                            isOperator ? () => deopPlayer(serverUuid, player) : () => opPlayer(serverUuid, player),
                            isOperator ? 'Deop' : 'Op',
                        )
                    }
                    className={'w-full justify-center'}
                    disabled={loading || !canManage}
                    title={!canManage ? 'Read-only access' : undefined}
                >
                    <FontAwesomeIcon icon={faCrown} className={'mr-2'} />
                    {isOperator ? 'Remove Operator' : 'Make Operator'}
                </Button>
                <Button
                    onClick={() => handleAction(() => banPlayer(serverUuid, player, ''), 'Ban')}
                    className={'w-full justify-center'}
                    disabled={loading || !canManage}
                    title={!canManage ? 'Read-only access' : undefined}
                >
                    <FontAwesomeIcon icon={faBan} className={'mr-2'} />
                    Ban Player
                </Button>
            </div>

            {/* Whisper form */}
            <div className={'mt-4 border-t border-neutral-700 pt-4'}>
                <h3 className={'mb-2 text-sm font-medium text-neutral-300'}>Send Private Message</h3>
                <Formik
                    initialValues={{ message: '' }}
                    validationSchema={object().shape({ message: string().required('Message is required') })}
                    onSubmit={async (values, { resetForm }) => {
                        await handleAction(() => whisperPlayer(serverUuid, player, values.message), 'Whisper');
                        resetForm();
                    }}
                >
                    <Form className={'flex gap-2'}>
                        <div className={'flex-1'}>
                            <Field name={'message'} placeholder={'Enter message...'} disabled={!canManage} />
                        </div>
                        <Button type={'submit'} disabled={loading || !canManage}>
                            <FontAwesomeIcon icon={faCommentDots} />
                        </Button>
                    </Form>
                </Formik>
            </div>

            <div className={'mt-4 flex justify-end'}>
                <Button.Text onClick={onDismissed}>Close</Button.Text>
            </div>
        </Modal>
    );
};

interface AddPlayerModalProps {
    visible: boolean;
    onDismissed: () => void;
    type: 'whitelist' | 'op' | 'ban' | 'ban-ip';
    serverUuid: string;
    onAction: () => void;
}

const AddPlayerModal = ({ visible, onDismissed, type, serverUuid, onAction }: AddPlayerModalProps) => {
    const [loading, setLoading] = useState(false);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();

    const titles: Record<string, string> = {
        whitelist: 'Add to Whitelist',
        op: 'Add Operator',
        ban: 'Ban Player',
        'ban-ip': 'Ban IP Address',
    };

    const validationSchema =
        type === 'ban-ip'
            ? object().shape({
                  target: string()
                      .required('IP address is required')
                      .matches(/^[\d.]+$/, 'Invalid IP format'),
              })
            : type === 'op'
              ? object().shape({
                    target: string().required('Player name is required'),
                    level: number().min(1).max(4).default(4),
                })
              : object().shape({ target: string().required('Player name is required') });

    return (
        <Modal visible={visible} onDismissed={onDismissed} closeOnBackground showSpinnerOverlay={loading}>
            <FlashMessageRender byKey={'server:player-manager:add'} className={'mb-4'} />
            <h2 className={'mb-4 text-xl font-semibold text-white'}>{titles[type]}</h2>
            <Formik
                initialValues={{ target: '', level: 4, reason: '' }}
                validationSchema={validationSchema}
                onSubmit={async (values, { resetForm }) => {
                    setLoading(true);
                    clearFlashes('server:player-manager:add');

                    try {
                        switch (type) {
                            case 'whitelist':
                                await addToWhitelist(serverUuid, values.target);
                                break;
                            case 'op':
                                await opPlayer(serverUuid, values.target);
                                break;
                            case 'ban':
                                await banPlayer(serverUuid, values.target, values.reason || '');
                                break;
                            case 'ban-ip':
                                await banIp(serverUuid, values.target, values.reason || '');
                                break;
                        }
                        addFlash({
                            key: 'server:player-manager',
                            type: 'success',
                            message: `${titles[type]} successful`,
                        });
                        onAction();
                        onDismissed();
                        resetForm();
                    } catch (error) {
                        clearAndAddHttpError({ key: 'server:player-manager:add', error });
                    } finally {
                        setLoading(false);
                    }
                }}
            >
                <Form>
                    <div className={'space-y-4'}>
                        <div>
                            <Field
                                name={'target'}
                                label={type === 'ban-ip' ? 'IP Address' : 'Player Name'}
                                placeholder={type === 'ban-ip' ? '192.168.1.1' : 'Enter player name...'}
                            />
                        </div>
                        {type === 'op' && (
                            <div>
                                <Field
                                    name={'level'}
                                    label={'Permission Level (1-4)'}
                                    type={'number'}
                                    min={1}
                                    max={4}
                                />
                                <p className={'mt-1 text-xs text-neutral-400'}>Level 4 = full operator permissions</p>
                            </div>
                        )}
                        {(type === 'ban' || type === 'ban-ip') && (
                            <div>
                                <Field
                                    name={'reason'}
                                    label={'Reason (optional)'}
                                    placeholder={'Enter ban reason...'}
                                />
                            </div>
                        )}
                    </div>
                    <div className={'mt-6 flex justify-end space-x-3'}>
                        <Button.Text onClick={onDismissed}>Cancel</Button.Text>
                        <Button type={'submit'} disabled={loading}>
                            {titles[type]}
                        </Button>
                    </div>
                </Form>
            </Formik>
        </Modal>
    );
};

interface PlayerListProps {
    title: string;
    icon: typeof faUsers;
    players: { name: string; uuid?: string; level?: number; reason?: string; source?: string }[];
    emptyMessage: string;
    onRemove?: (name: string) => void;
    onPlayerClick?: (name: string) => void;
    loading: boolean;
    badge?: (player: { name: string; level?: number }) => string | null;
}

const PlayerList = ({
    title,
    icon,
    players,
    emptyMessage,
    onRemove,
    onPlayerClick,
    loading,
    badge,
}: PlayerListProps) => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    return (
        <div className={'rounded-lg bg-zinc-800 p-4'}>
            <div className={'mb-4 flex items-center justify-between'}>
                <h3 className={'flex items-center gap-2 font-semibold text-white'}>
                    <FontAwesomeIcon icon={icon} style={{ color: primary }} />
                    {title}
                    <span className={'ml-2 rounded bg-zinc-700 px-2 py-0.5 text-xs text-neutral-400'}>
                        {players.length}
                    </span>
                </h3>
            </div>
            {players.length === 0 ? (
                <p className={'py-4 text-center text-sm text-neutral-500'}>{emptyMessage}</p>
            ) : (
                <div className={'max-h-64 space-y-2 overflow-y-auto'}>
                    {players.map((player, index) => (
                        <div
                            key={`${player.name}-${index}`}
                            className={classNames(
                                'flex items-center justify-between rounded bg-zinc-700 p-2',
                                onPlayerClick && 'cursor-pointer transition-colors hover:bg-zinc-600',
                            )}
                            onClick={() => onPlayerClick?.(player.name)}
                        >
                            <div className={'flex items-center gap-2'}>
                                <img
                                    src={`https://mc-heads.net/avatar/${player.uuid || player.name}/32`}
                                    alt={player.name}
                                    className={'h-8 w-8 rounded'}
                                />
                                <div>
                                    <span className={'text-sm font-medium text-white'}>{player.name}</span>
                                    {badge && badge(player) && (
                                        <span
                                            className={'ml-2 rounded px-1.5 py-0.5 text-xs'}
                                            style={{ backgroundColor: `${primary}30`, color: primary }}
                                        >
                                            {badge(player)}
                                        </span>
                                    )}
                                    {player.reason && (
                                        <p className={'text-xs text-neutral-400'}>Reason: {player.reason}</p>
                                    )}
                                </div>
                            </div>
                            {onRemove && (
                                <button
                                    onClick={e => {
                                        e.stopPropagation();
                                        onRemove(player.name);
                                    }}
                                    disabled={loading}
                                    className={'p-1 text-neutral-400 transition-colors hover:text-red-400'}
                                >
                                    <FontAwesomeIcon icon={faTrash} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [status, setStatus] = useState<PlayerManagerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
    const [addModalType, setAddModalType] = useState<'whitelist' | 'op' | 'ban' | 'ban-ip' | null>(null);
    const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
    const [inventoryPlayer, setInventoryPlayer] = useState<string | null>(null);
    const [attributePlayer, setAttributePlayer] = useState<string | null>(null);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const primary = useStoreState(state => state.theme.data!.colors.primary);
    const uuid = ServerContext.useStoreState(state => state.server.data?.uuid);
    const [canManage] = usePermissions(['extension.manage']);

    const fetchStatus = useCallback(() => {
        if (!uuid) return;

        setLoading(true);

        // Fetch both status and version in parallel
        Promise.all([
            getPlayerManagerStatus(uuid),
            getServerVersion(uuid).catch(() => ({ success: false, version: null })),
        ])
            .then(([statusData, versionData]) => {
                setStatus(statusData);
                if (versionData.success && versionData.version) {
                    setServerVersion(versionData.version);
                }
            })
            .catch(error => clearAndAddHttpError({ key: 'server:player-manager', error }))
            .finally(() => setLoading(false));
    }, [uuid]);

    const isPlayerOnline = useCallback(
        (playerName: string): boolean =>
            status?.server.players.list?.some(p => p.name.toLowerCase() === playerName.toLowerCase()) ?? false,
        [status],
    );

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Refresh every 30 seconds
        return () => clearInterval(interval);
    }, [fetchStatus]);

    const handleToggleWhitelist = async () => {
        if (!canManage) return;
        if (!uuid || !status) return;

        setActionLoading(true);
        clearFlashes('server:player-manager');

        try {
            await setWhitelistEnabled(uuid, !status.whitelistEnabled);
            addFlash({
                key: 'server:player-manager',
                type: 'success',
                message: `Whitelist ${status.whitelistEnabled ? 'disabled' : 'enabled'} successfully`,
            });
            fetchStatus();
        } catch (error) {
            clearAndAddHttpError({ key: 'server:player-manager', error });
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemoveFromList = async (type: 'whitelist' | 'op' | 'ban' | 'ban-ip', target: string) => {
        if (!canManage) return;
        if (!uuid) return;

        setActionLoading(true);
        clearFlashes('server:player-manager');

        try {
            switch (type) {
                case 'whitelist':
                    await removeFromWhitelist(uuid, target);
                    break;
                case 'op':
                    await deopPlayer(uuid, target);
                    break;
                case 'ban':
                    await unbanPlayer(uuid, target);
                    break;
                case 'ban-ip':
                    await unbanIp(uuid, target);
                    break;
            }
            addFlash({ key: 'server:player-manager', type: 'success', message: 'Removed successfully' });
            fetchStatus();
        } catch (error) {
            clearAndAddHttpError({ key: 'server:player-manager', error });
        } finally {
            setActionLoading(false);
        }
    };

    if (loading && !status) {
        return (
            <PageContentBlock title={'Player Manager'}>
                <div className={'flex items-center justify-center py-16'}>
                    <Spinner size={'large'} />
                </div>
            </PageContentBlock>
        );
    }

    if (!status) {
        return (
            <PageContentBlock title={'Player Manager'}>
                <FlashMessageRender byKey={'server:player-manager'} className={'mb-4'} />
                <div className={'rounded-lg bg-neutral-800 p-8 text-center'}>
                    <p className={'text-neutral-400'}>Failed to load player manager data.</p>
                    <Button className={'mt-4'} onClick={fetchStatus}>
                        Try Again
                    </Button>
                </div>
            </PageContentBlock>
        );
    }

    return (
        <PageContentBlock title={'Player Manager'}>
            <FlashMessageRender byKey={'server:player-manager'} className={'mb-4'} />

            {/* Header */}
            <div className={'mb-6 flex items-center justify-between'}>
                <button
                    onClick={() => navigate(`/server/${id}/extensions`)}
                    className={'flex items-center gap-2 text-neutral-400 transition-colors hover:text-white'}
                >
                    <FontAwesomeIcon icon={faArrowLeft} />
                    Back to Extensions
                </button>
                <Button onClick={fetchStatus} disabled={loading}>
                    <FontAwesomeIcon icon={faSync} className={classNames('mr-2', loading && 'animate-spin')} />
                    Refresh
                </Button>
            </div>

            {/* Server Status Card */}
            <div className={'mb-6 rounded-lg bg-zinc-800 p-6'}>
                <div className={'flex items-center justify-between'}>
                    <div className={'flex items-center gap-4'}>
                        <div
                            className={classNames(
                                'flex h-16 w-16 items-center justify-center rounded-lg',
                                status.server.online ? 'bg-green-500/20' : 'bg-red-500/20',
                            )}
                        >
                            <FontAwesomeIcon
                                icon={faCircle}
                                className={classNames(
                                    'text-2xl',
                                    status.server.online ? 'text-green-500' : 'text-red-500',
                                )}
                            />
                        </div>
                        <div>
                            <h2 className={'text-xl font-semibold text-white'}>
                                Server {status.server.online ? 'Online' : 'Offline'}
                            </h2>
                            {status.server.online && (
                                <>
                                    <p className={'text-sm text-neutral-400'}>
                                        {status.server.players.online}/{status.server.players.max} Players
                                    </p>
                                    {serverVersion && (
                                        <p className={'text-xs text-neutral-500'}>
                                            {serverVersion.raw}
                                            {serverVersion.supportsAttributes && (
                                                <span className={'ml-2 text-green-500'}>• Attributes supported</span>
                                            )}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Online Players */}
                {status.server.online && status.server.players.list.length > 0 && (
                    <div className={'mt-4 border-t border-neutral-700 pt-4'}>
                        <h3 className={'mb-2 text-sm font-medium text-neutral-300'}>Online Players</h3>
                        <div className={'flex flex-wrap gap-2'}>
                            {status.server.players.list.map(player => (
                                <button
                                    key={player.name}
                                    onClick={() => setSelectedPlayer(player.name)}
                                    className={
                                        'flex items-center gap-2 rounded-lg bg-zinc-700 px-3 py-2 transition-colors hover:bg-zinc-600'
                                    }
                                >
                                    <img
                                        src={`https://mc-heads.net/avatar/${player.uuid || player.name}/24`}
                                        alt={player.name}
                                        className={'h-6 w-6 rounded'}
                                    />
                                    <span className={'text-sm text-white'}>{player.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Management Sections */}
            <div className={'grid gap-6 lg:grid-cols-2'}>
                {/* Whitelist */}
                <div>
                    <div className={'mb-3 flex items-center justify-between'}>
                        <button
                            onClick={handleToggleWhitelist}
                            disabled={actionLoading || !canManage}
                            className={'flex items-center gap-2 text-sm text-neutral-400 hover:text-white'}
                            title={!canManage ? 'Read-only access' : undefined}
                        >
                            <FontAwesomeIcon
                                icon={status.whitelistEnabled ? faToggleOn : faToggleOff}
                                className={'text-lg'}
                                style={{ color: status.whitelistEnabled ? primary : '#6b7280' }}
                            />
                            Whitelist {status.whitelistEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <Button.Text
                            onClick={() => setAddModalType('whitelist')}
                            disabled={!canManage}
                            title={!canManage ? 'Read-only access' : undefined}
                        >
                            <FontAwesomeIcon icon={faPlus} className={'mr-1'} />
                            Add
                        </Button.Text>
                    </div>
                    <PlayerList
                        title={'Whitelist'}
                        icon={faListCheck}
                        players={status.whitelist.map(p => ({ name: p.name, uuid: p.uuid }))}
                        emptyMessage={'No players whitelisted'}
                        onRemove={canManage ? name => handleRemoveFromList('whitelist', name) : undefined}
                        onPlayerClick={name => setSelectedPlayer(name)}
                        loading={actionLoading}
                    />
                </div>

                {/* Operators */}
                <div>
                    <div className={'mb-3 flex items-center justify-end'}>
                        <Button.Text
                            onClick={() => setAddModalType('op')}
                            disabled={!canManage}
                            title={!canManage ? 'Read-only access' : undefined}
                        >
                            <FontAwesomeIcon icon={faPlus} className={'mr-1'} />
                            Add
                        </Button.Text>
                    </div>
                    <PlayerList
                        title={'Operators'}
                        icon={faUserShield}
                        players={status.operators.map(p => ({ name: p.name, uuid: p.uuid, level: p.level }))}
                        emptyMessage={'No operators configured'}
                        onRemove={canManage ? name => handleRemoveFromList('op', name) : undefined}
                        onPlayerClick={name => setSelectedPlayer(name)}
                        loading={actionLoading}
                        badge={() => 'op'}
                    />
                </div>

                {/* Banned Players */}
                <div>
                    <div className={'mb-3 flex items-center justify-end'}>
                        <Button.Text
                            onClick={() => setAddModalType('ban')}
                            disabled={!canManage}
                            title={!canManage ? 'Read-only access' : undefined}
                        >
                            <FontAwesomeIcon icon={faPlus} className={'mr-1'} />
                            Add
                        </Button.Text>
                    </div>
                    <PlayerList
                        title={'Banned Players'}
                        icon={faBan}
                        players={status.bannedPlayers.map(p => ({
                            name: p.name,
                            uuid: p.uuid,
                            reason: p.reason,
                            source: p.source,
                        }))}
                        emptyMessage={'No players banned'}
                        onRemove={canManage ? name => handleRemoveFromList('ban', name) : undefined}
                        loading={actionLoading}
                    />
                </div>

                {/* Banned IPs */}
                <div>
                    <div className={'mb-3 flex items-center justify-end'}>
                        <Button.Text
                            onClick={() => setAddModalType('ban-ip')}
                            disabled={!canManage}
                            title={!canManage ? 'Read-only access' : undefined}
                        >
                            <FontAwesomeIcon icon={faPlus} className={'mr-1'} />
                            Add
                        </Button.Text>
                    </div>
                    <div className={'rounded-lg bg-zinc-800 p-4'}>
                        <div className={'mb-4 flex items-center justify-between'}>
                            <h3 className={'flex items-center gap-2 font-semibold text-white'}>
                                <FontAwesomeIcon icon={faNetworkWired} style={{ color: primary }} />
                                Banned IPs
                                <span className={'ml-2 rounded bg-zinc-700 px-2 py-0.5 text-xs text-neutral-400'}>
                                    {status.bannedIps.length}
                                </span>
                            </h3>
                        </div>
                        {status.bannedIps.length === 0 ? (
                            <p className={'py-4 text-center text-sm text-neutral-500'}>No IPs banned</p>
                        ) : (
                            <div className={'max-h-64 space-y-2 overflow-y-auto'}>
                                {status.bannedIps.map((ip, index) => (
                                    <div
                                        key={`${ip.ip}-${index}`}
                                        className={'flex items-center justify-between rounded bg-zinc-700 p-2'}
                                    >
                                        <div>
                                            <span className={'font-mono text-sm text-white'}>{ip.ip}</span>
                                            {ip.reason && (
                                                <p className={'text-xs text-neutral-400'}>Reason: {ip.reason}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleRemoveFromList('ban-ip', ip.ip)}
                                            disabled={actionLoading || !canManage}
                                            title={!canManage ? 'Read-only access' : undefined}
                                            className={classNames(
                                                'p-1 text-neutral-400 transition-colors hover:text-red-400',
                                                !canManage && 'cursor-not-allowed opacity-50 hover:text-neutral-400',
                                            )}
                                        >
                                            <FontAwesomeIcon icon={faTrash} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Player Actions Modal */}
            {selectedPlayer && uuid && (
                <PlayerActionsModal
                    visible={!!selectedPlayer}
                    onDismissed={() => setSelectedPlayer(null)}
                    player={selectedPlayer}
                    serverUuid={uuid}
                    onAction={fetchStatus}
                    supportsAttributes={serverVersion?.supportsAttributes || false}
                    onViewInventory={() => setInventoryPlayer(selectedPlayer)}
                    onEditAttributes={() => setAttributePlayer(selectedPlayer)}
                    isOperator={
                        status?.operators.some(op => op.name.toLowerCase() === selectedPlayer.toLowerCase()) || false
                    }
                    isOnline={isPlayerOnline(selectedPlayer)}
                    canManage={canManage ?? false}
                />
            )}

            {/* Inventory Viewer Modal */}
            {inventoryPlayer && uuid && (
                <InventoryViewer
                    visible={!!inventoryPlayer}
                    onDismissed={() => setInventoryPlayer(null)}
                    onBack={() => setSelectedPlayer(inventoryPlayer)}
                    serverUuid={uuid}
                    playerName={inventoryPlayer}
                />
            )}

            {/* Attribute Editor Modal */}
            {attributePlayer && uuid && (
                <AttributeEditor
                    visible={!!attributePlayer}
                    onDismissed={() => setAttributePlayer(null)}
                    onBack={() => setSelectedPlayer(attributePlayer)}
                    serverUuid={uuid}
                    playerName={attributePlayer}
                    isOnline={isPlayerOnline(attributePlayer)}
                    canManage={canManage ?? false}
                />
            )}

            {/* Add Player Modal */}
            {addModalType && uuid && canManage && (
                <AddPlayerModal
                    visible={!!addModalType}
                    onDismissed={() => setAddModalType(null)}
                    type={addModalType}
                    serverUuid={uuid}
                    onAction={fetchStatus}
                />
            )}
        </PageContentBlock>
    );
};
