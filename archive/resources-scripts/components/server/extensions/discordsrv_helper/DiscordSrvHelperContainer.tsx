import { useEffect, useMemo, useState } from 'react';
import { ServerContext } from '@/state/server';
import PageContentBlock from '@/elements/PageContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import InputField from '@/elements/inputs/InputField';
import { usePermissions } from '@/plugins/usePermissions';
import {
    getDiscordSrvHelperStatus,
    DiscordSrvHelperStatus,
    installDiscordSrv,
    setDiscordSrvToken,
    setDiscordSrvGlobalChannel,
    getDiscordSrvHistory,
    revertDiscordSrvHistory,
    DiscordSrvHelperHistoryEntry,
    getDiscordSrvSubusers,
    setDiscordSrvSubuserAccess,
    DiscordSrvHelperSubuserAccess,
} from '@/api/server/extensions/discordSrvHelper';

export default () => {
    const uuid = ServerContext.useStoreState(state => state.server.data?.uuid);
    const serverOwner = ServerContext.useStoreState(state => state.server.data?.serverOwner);

    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const [status, setStatus] = useState<DiscordSrvHelperStatus | null>(null);
    const [loading, setLoading] = useState(true);

    const [jarUrl, setJarUrl] = useState('');
    const [botToken, setBotToken] = useState('');
    const [globalChannelId, setGlobalChannelId] = useState('');
    const [clientId, setClientId] = useState('');

    const [history, setHistory] = useState<DiscordSrvHelperHistoryEntry[]>([]);
    const [subusers, setSubusers] = useState<DiscordSrvHelperSubuserAccess[]>([]);

    const [canReadExtensions] = usePermissions('extension.read');
    const [canManageExtensions] = usePermissions('extension.manage');
    const [canFileRead] = usePermissions('file.read');
    const [canFileCreate] = usePermissions('file.create');
    const [canFileUpdate] = usePermissions('file.update');
    const [canFileReadContent] = usePermissions('file.read-content');

    const canInstall = canManageExtensions && canFileCreate && canFileUpdate;
    const canSetToken = canManageExtensions && canFileCreate && canFileUpdate && canFileReadContent;
    const canSetChannel = canManageExtensions && canFileUpdate && canFileReadContent;

    const inviteUrl = useMemo(() => {
        if (!clientId || clientId.trim().length === 0) return null;
        const encoded = encodeURIComponent('bot applications.commands');
        return `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
            clientId.trim(),
        )}&permissions=0&scope=${encoded}`;
    }, [clientId]);

    const refresh = async (opts?: { clearFlashes?: boolean }) => {
        if (!uuid) return;
        if (opts?.clearFlashes) {
            clearFlashes('server:extensions:discordsrv');
        }

        try {
            const s = await getDiscordSrvHelperStatus(uuid);
            setStatus(s);
        } catch (error) {
            clearAndAddHttpError({ key: 'server:extensions:discordsrv', error });
        }
    };

    const refreshOwnerData = async () => {
        if (!uuid || !serverOwner) return;
        try {
            const [h, su] = await Promise.all([getDiscordSrvHistory(uuid), getDiscordSrvSubusers(uuid)]);
            setHistory(h);
            setSubusers(su);
        } catch (error) {
            // Owner-only calls, just surface as a flash.
            clearAndAddHttpError({ key: 'server:extensions:discordsrv', error });
        }
    };

    useEffect(() => {
        if (!uuid) return;

        setLoading(true);
        refresh({ clearFlashes: true })
            .then(() => refreshOwnerData())
            .finally(() => setLoading(false));
    }, [uuid, serverOwner]);

    if (!canReadExtensions) {
        return (
            <PageContentBlock title={'DiscordSRV Helper'}>
                <div className={'rounded-lg bg-zinc-800 p-6'}>
                    <p className={'text-neutral-300'}>You do not have permission to view extensions.</p>
                </div>
            </PageContentBlock>
        );
    }

    if (!canFileRead) {
        return (
            <PageContentBlock title={'DiscordSRV Helper'}>
                <div className={'rounded-lg bg-zinc-800 p-6'}>
                    <p className={'text-neutral-300'}>
                        This extension requires file read permission to check plugin status.
                    </p>
                    <p className={'mt-2 text-sm text-neutral-400'}>Required: file.read</p>
                </div>
            </PageContentBlock>
        );
    }

    return (
        <PageContentBlock title={'DiscordSRV Helper'}>
            <FlashMessageRender byKey={'server:extensions:discordsrv'} className={'mb-4'} />

            {loading ? (
                <div className={'flex items-center justify-center py-16'}>
                    <Spinner size={'large'} />
                </div>
            ) : (
                <>
                    <div className={'rounded-lg bg-zinc-800 p-6'}>
                        <h3 className={'text-lg font-semibold text-white'}>Status</h3>
                        <div className={'mt-3 grid gap-2 text-sm text-neutral-300'}>
                            <div>Installed: {status?.installed ? 'Yes' : 'No'}</div>
                            <div>Plugin Jar: {status?.plugin_jar || '—'}</div>
                            <div>Plugin Folder: {status?.plugin_folder_present ? 'Present' : 'Missing'}</div>
                            <div>Token File: {status?.token_file_present ? 'Present' : 'Missing'}</div>
                            <div>Config: {status?.config_present ? 'Present' : 'Missing'}</div>
                        </div>
                    </div>

                    <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                        <h3 className={'text-lg font-semibold text-white'}>Install</h3>
                        <p className={'mt-2 text-sm text-neutral-400'}>
                            Installs DiscordSRV to{' '}
                            <span className={'text-neutral-200'}>
                                /plugins/{'{'}DiscordSRV.jar{'}'}
                            </span>
                            .
                        </p>

                        <div className={'mt-4'}>
                            <label className={'text-xs uppercase text-neutral-400'}>Optional Jar URL</label>
                            <InputField
                                className={'mt-2 w-full bg-neutral-800 text-neutral-200'}
                                value={jarUrl}
                                onChange={e => setJarUrl(e.target.value)}
                                placeholder={'https://.../DiscordSRV-....jar'}
                            />
                        </div>

                        <div className={'mt-4'}>
                            <Button
                                disabled={!canInstall}
                                onClick={async () => {
                                    if (!uuid) return;
                                    clearFlashes('server:extensions:discordsrv');
                                    try {
                                        await installDiscordSrv(
                                            uuid,
                                            jarUrl.trim().length > 0 ? jarUrl.trim() : undefined,
                                        );
                                        addFlash({
                                            key: 'server:extensions:discordsrv',
                                            type: 'success',
                                            message: 'DiscordSRV install started.',
                                        });
                                        await refresh();
                                    } catch (error) {
                                        clearAndAddHttpError({ key: 'server:extensions:discordsrv', error });
                                    }
                                }}
                            >
                                Install DiscordSRV
                            </Button>
                            {!canInstall && (
                                <p className={'mt-2 text-xs text-neutral-500'}>
                                    Requires: extension.manage + file.create + file.update
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                        <h3 className={'text-lg font-semibold text-white'}>Bot Token</h3>
                        <p className={'mt-2 text-sm text-neutral-400'}>
                            Saves the token to <span className={'text-neutral-200'}>/plugins/DiscordSRV/.token</span>.
                        </p>
                        <div className={'mt-4'}>
                            <label className={'text-xs uppercase text-neutral-400'}>Bot Token</label>
                            <InputField
                                className={'mt-2 w-full bg-neutral-800 text-neutral-200'}
                                value={botToken}
                                onChange={e => setBotToken(e.target.value)}
                                placeholder={'Paste bot token'}
                                type={'password'}
                            />
                        </div>
                        <div className={'mt-4'}>
                            <Button
                                disabled={!canSetToken || botToken.trim().length === 0}
                                onClick={async () => {
                                    if (!uuid) return;
                                    clearFlashes('server:extensions:discordsrv');
                                    try {
                                        await setDiscordSrvToken(uuid, botToken);
                                        addFlash({
                                            key: 'server:extensions:discordsrv',
                                            type: 'success',
                                            message: 'Token saved.',
                                        });
                                        setBotToken('');
                                        await refresh();
                                        await refreshOwnerData();
                                    } catch (error) {
                                        clearAndAddHttpError({ key: 'server:extensions:discordsrv', error });
                                    }
                                }}
                            >
                                Save Token
                            </Button>
                            {!canSetToken && (
                                <p className={'mt-2 text-xs text-neutral-500'}>
                                    Requires: extension.manage + file.create + file.update + file.read-content
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                        <h3 className={'text-lg font-semibold text-white'}>Link Global Chat</h3>
                        <p className={'mt-2 text-sm text-neutral-400'}>
                            Sets <span className={'text-neutral-200'}>Channels.global</span> in DiscordSRV config.yml.
                        </p>
                        <div className={'mt-4'}>
                            <label className={'text-xs uppercase text-neutral-400'}>Discord Channel ID</label>
                            <InputField
                                className={'mt-2 w-full bg-neutral-800 text-neutral-200'}
                                value={globalChannelId}
                                onChange={e => setGlobalChannelId(e.target.value)}
                                placeholder={'123456789012345678'}
                            />
                        </div>
                        <div className={'mt-4'}>
                            <Button
                                disabled={!canSetChannel || globalChannelId.trim().length === 0}
                                onClick={async () => {
                                    if (!uuid) return;
                                    clearFlashes('server:extensions:discordsrv');
                                    try {
                                        await setDiscordSrvGlobalChannel(uuid, globalChannelId.trim());
                                        addFlash({
                                            key: 'server:extensions:discordsrv',
                                            type: 'success',
                                            message: 'Global channel saved.',
                                        });
                                        await refresh();
                                        await refreshOwnerData();
                                    } catch (error) {
                                        clearAndAddHttpError({ key: 'server:extensions:discordsrv', error });
                                    }
                                }}
                            >
                                Save Channel
                            </Button>
                            {!canSetChannel && (
                                <p className={'mt-2 text-xs text-neutral-500'}>
                                    Requires: extension.manage + file.update + file.read-content
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                        <h3 className={'text-lg font-semibold text-white'}>Invite Link</h3>
                        <p className={'mt-2 text-sm text-neutral-400'}>
                            Discord invite links require the Application Client ID (not the token).
                        </p>
                        <div className={'mt-4'}>
                            <label className={'text-xs uppercase text-neutral-400'}>Application Client ID</label>
                            <InputField
                                className={'mt-2 w-full bg-neutral-800 text-neutral-200'}
                                value={clientId}
                                onChange={e => setClientId(e.target.value)}
                                placeholder={'123456789012345678'}
                            />
                        </div>
                        <div className={'mt-4'}>
                            <Button
                                disabled={!inviteUrl}
                                onClick={() => {
                                    if (inviteUrl) window.open(inviteUrl, '_blank', 'noopener,noreferrer');
                                }}
                            >
                                Open Invite Link
                            </Button>
                        </div>
                    </div>

                    {serverOwner && (
                        <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                            <h3 className={'text-lg font-semibold text-white'}>Revert Changes (Owner Only)</h3>
                            <p className={'mt-2 text-sm text-neutral-400'}>
                                Shows recent config/token changes made through this extension.
                            </p>

                            {history.length === 0 ? (
                                <p className={'mt-4 text-sm text-neutral-500'}>No snapshots available.</p>
                            ) : (
                                <div className={'mt-4 space-y-2'}>
                                    {history.map(h => (
                                        <div
                                            key={h.id}
                                            className={'flex items-center justify-between rounded bg-zinc-900 p-3'}
                                        >
                                            <div className={'text-sm text-neutral-300'}>
                                                <div className={'font-medium text-white'}>{h.action}</div>
                                                <div className={'text-xs text-neutral-500'}>
                                                    {new Date(h.created_at).toLocaleString()}{' '}
                                                    {h.actor ? `• ${h.actor.email}` : ''}
                                                </div>
                                            </div>
                                            <Button
                                                onClick={async () => {
                                                    if (!uuid) return;
                                                    clearFlashes('server:extensions:discordsrv');
                                                    try {
                                                        await revertDiscordSrvHistory(uuid, h.id);
                                                        addFlash({
                                                            key: 'server:extensions:discordsrv',
                                                            type: 'success',
                                                            message: 'Snapshot reverted.',
                                                        });
                                                        await refresh();
                                                    } catch (error) {
                                                        clearAndAddHttpError({
                                                            key: 'server:extensions:discordsrv',
                                                            error,
                                                        });
                                                    }
                                                }}
                                            >
                                                Revert
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {serverOwner && (
                        <div className={'mt-6 rounded-lg bg-zinc-800 p-6'}>
                            <h3 className={'text-lg font-semibold text-white'}>Subuser Access (Owner Only)</h3>
                            <p className={'mt-2 text-sm text-neutral-400'}>
                                Enable/disable this extension per subuser.
                            </p>

                            {subusers.length === 0 ? (
                                <p className={'mt-4 text-sm text-neutral-500'}>No subusers.</p>
                            ) : (
                                <div className={'mt-4 space-y-2'}>
                                    {subusers.map(s => (
                                        <div
                                            key={s.uuid}
                                            className={'flex items-center justify-between rounded bg-zinc-900 p-3'}
                                        >
                                            <div className={'text-sm text-neutral-300'}>
                                                <div className={'font-medium text-white'}>{s.email}</div>
                                                <div className={'text-xs text-neutral-500'}>{s.username}</div>
                                            </div>
                                            <Button
                                                onClick={async () => {
                                                    if (!uuid) return;
                                                    clearFlashes('server:extensions:discordsrv');
                                                    try {
                                                        await setDiscordSrvSubuserAccess(uuid, s.uuid, s.disabled);
                                                        await refreshOwnerData();
                                                    } catch (error) {
                                                        clearAndAddHttpError({
                                                            key: 'server:extensions:discordsrv',
                                                            error,
                                                        });
                                                    }
                                                }}
                                            >
                                                {s.disabled ? 'Enable' : 'Disable'}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </PageContentBlock>
    );
};
