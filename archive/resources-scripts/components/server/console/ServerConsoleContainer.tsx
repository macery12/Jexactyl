import { memo } from 'react';
import { Link } from 'react-router-dom';
import isEqual from 'react-fast-compare';
import { Alert } from '@/elements/alert';
import Can from '@/elements/Can';
import Spinner from '@/elements/Spinner';
import Console from '@server/console/Console';
import PowerButtons from '@server/console/PowerButtons';
import ServerDetailsBlock from '@server/console/ServerDetailsBlock';
import StatGraphs from '@server/console/StatGraphs';
import Features from '@feature/Features';
import { ServerContext, ServerStatus } from '@/state/server';
import classNames from 'classnames';
import { usePersistedState } from '@/plugins/usePersistedState';
import { useStoreState } from '@/state/hooks';
import Pill from '@/elements/Pill';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircle, faDownload, faSpinner } from '@fortawesome/free-solid-svg-icons';
import EditServerDialog from './EditServerDialog';
import PageContentBlock from '@/elements/PageContentBlock';
import ScopedAlert from '@account/ScopedAlert';

export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

function statusToColor(status: ServerStatus): string {
    switch (status) {
        case 'running':
            return 'text-green-500';
        case 'offline':
            return 'text-red-500';
        default:
            return 'text-yellow-500';
    }
}

function ServerConsoleContainer() {
    const user = useStoreState(state => state.user.data!);
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const name = ServerContext.useStoreState(state => state.server.data!.name);
    const description = ServerContext.useStoreState(state => state.server.data!.description);
    const isInstalling = ServerContext.useStoreState(state => state.server.isInstalling);
    const [expand, setExpand] = usePersistedState<boolean>(`console_expand_${user.uuid}`, false);
    const isTransferring = ServerContext.useStoreState(state => state.server.data!.isTransferring);
    const eggFeatures = ServerContext.useStoreState(state => state.server.data!.eggFeatures, isEqual);
    const isNodeUnderMaintenance = ServerContext.useStoreState(state => state.server.data!.isNodeUnderMaintenance);
    const status = ServerContext.useStoreState(state => state.status.value);
    const renewalDate = ServerContext.useStoreState(state => state.server.data!.renewalDate);
    const isDeletionScheduled = ServerContext.useStoreState(state => state.server.data!.isDeletionScheduled ?? false);
    const billingProductId = ServerContext.useStoreState(state => state.server.data!.billingProductId);
    const settings = useStoreState(state => state.everest.data!.billing);
    const settingsPath = `/server/${uuid}/settings`;

    // Get configurable renewal settings
    const freeGraceDays = settings.renewal?.free_suspension_days || 7;

    // Calculate days until renewal (can be negative if overdue)
    const daysUntilRenewal = renewalDate
        ? Math.floor((new Date(renewalDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : null;

    // Show warning if within grace period (from expiration to grace period end)
    const showRenewalWarning =
        billingProductId &&
        daysUntilRenewal !== null &&
        daysUntilRenewal <= 0 &&
        Math.abs(daysUntilRenewal) <= freeGraceDays;

    return (
        <PageContentBlock title={'Server Console'} showFlashKey={'console:share'}>
            {isDeletionScheduled && renewalDate && (
                <Alert type={'warning'} className={'mb-4'}>
                    Scheduled for deletion on{' '}
                    {new Date(renewalDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}{' '}
                    (end of day).{' '}
                    <Link to={settingsPath} className={'font-semibold underline'}>
                        Manage or cancel in Settings.
                    </Link>
                </Alert>
            )}
            {showRenewalWarning && (
                <Alert type={'warning'} className={'mb-4'}>
                    Your server is {Math.abs(daysUntilRenewal!)} day{Math.abs(daysUntilRenewal!) !== 1 ? 's' : ''}{' '}
                    overdue for renewal. Please renew within {freeGraceDays} days to avoid permanent suspension. Your
                    server files and data will be preserved.
                </Alert>
            )}
            {(isNodeUnderMaintenance || isInstalling || isTransferring) && (
                <Alert type={'warning'} className={'mb-4'}>
                    {isNodeUnderMaintenance
                        ? 'The node of this server is currently under maintenance and all actions are unavailable.'
                        : isInstalling
                          ? 'This server is currently running its installation process and most actions are unavailable.'
                          : 'This server is currently being transferred to another node and all actions are unavailable.'}
                </Alert>
            )}
            {/* Server-scoped top-center alerts between header and console */}
            <ScopedAlert scope="server" position="top-center" />
            <div className={'mb-4 flex justify-between gap-4 rounded-lg bg-black/50 p-5'}>
                <div className={'hidden pr-4 sm:col-span-2 sm:block lg:col-span-3'}>
                    <div className={'flex items-center space-x-2'}>
                        <h1 className={'font-header text-2xl leading-relaxed text-slate-50 line-clamp-1'}>{name}</h1>
                        <Pill>
                            {isInstalling && (
                                <>
                                    <FontAwesomeIcon icon={faDownload} className={'my-auto mr-1'} />
                                    Installing
                                </>
                            )}
                            {isTransferring && (
                                <>
                                    <FontAwesomeIcon icon={faSpinner} className={'my-auto mr-1 animate-spin'} />
                                    Transferring
                                </>
                            )}
                            {!isInstalling && !isTransferring && (
                                <>
                                    <FontAwesomeIcon
                                        icon={faCircle}
                                        className={classNames('my-auto mr-1 w-2', statusToColor(status))}
                                    />
                                    {status}
                                </>
                            )}
                        </Pill>
                        <EditServerDialog />
                    </div>
                    <p className={'text-sm line-clamp-2'}>{description ?? uuid}</p>
                </div>
                <div className={'my-auto'}>
                    <Can action={['control.start', 'control.stop', 'control.restart']} matchAny>
                        <PowerButtons className={' flex space-x-2 sm:justify-center'} />
                    </Can>
                </div>
            </div>
            {!expand && <ServerDetailsBlock className={'order-last col-span-4 lg:order-none lg:col-span-1'} />}
            <div className={'mb-4 grid grid-cols-4 gap-2 sm:gap-4'}>
                <div className={classNames('col-span-4 flex', !expand && 'lg:col-span-3')}>
                    <Spinner.Suspense>
                        <Console expand={expand} setExpand={setExpand} />
                    </Spinner.Suspense>
                </div>
                {!expand && (
                    <div className={'col-span-4 my-auto lg:col-span-1'}>
                        <div className={'grid grid-cols-1 gap-2'}>
                            <Spinner.Suspense>
                                <StatGraphs />
                            </Spinner.Suspense>
                        </div>
                    </div>
                )}
            </div>
            <Features enabled={eggFeatures} />
        </PageContentBlock>
    );
}

export default memo(ServerConsoleContainer, isEqual);
