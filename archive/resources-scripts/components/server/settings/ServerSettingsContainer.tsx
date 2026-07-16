import { useState } from 'react';
import { Formik, Form } from 'formik';
import { object, string } from 'yup';
import tw from 'twin.macro';
import { faCog, faExclamationTriangle, faInfoCircle, faRedo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import Field from '@/elements/Field';
import Label from '@/elements/Label';
import PageContentBlock from '@/elements/PageContentBlock';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { Alert } from '@/elements/alert';
import CopyOnClick from '@/elements/CopyOnClick';
import { ServerContext } from '@/state/server';
import { renameServer, reinstallServer } from '@/api/routes/server';
import { cancelDeletion, scheduleDeletion } from '@/api/routes/server/deletion';
import useFlash from '@/plugins/useFlash';
import Can from '@/elements/Can';
import { usePermissions } from '@/plugins/usePermissions';
import ChangeEggContainer from '@/components/server/billing/ChangeEggContainer';

const nameSchema = object().shape({
    name: string().required('Server name is required.').min(1, 'Server name cannot be empty.').max(191),
});

export default () => {
    const server = ServerContext.useStoreState(state => state.server.data!);
    const serverStatus = ServerContext.useStoreState(state => state.status.value);
    const setServer = ServerContext.useStoreActions(actions => actions.server.setServer);

    const [reinstallOpen, setReinstallOpen] = useState(false);
    const [reinstalling, setReinstalling] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduling, setScheduling] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const canRename = usePermissions('settings.rename')[0];
    const canReinstall = usePermissions('settings.reinstall')[0];
    const isStopped = serverStatus === null || serverStatus === 'offline';

    const submitRename = ({ name }: { name: string }) => {
        clearFlashes('settings');
        return renameServer(server.uuid, name, server.description ?? undefined)
            .then(() => {
                setServer({ ...server, name });
                addFlash({
                    key: 'settings',
                    type: 'success',
                    message: 'Server name updated successfully.',
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'settings', error }));
    };

    const handleReinstall = () => {
        setReinstalling(true);
        clearFlashes('settings');
        reinstallServer(server.uuid)
            .then(() =>
                addFlash({
                    key: 'settings',
                    type: 'success',
                    message: 'Your server has begun the reinstallation process.',
                }),
            )
            .catch(error => {
                clearAndAddHttpError({ key: 'settings', error });
            })
            .finally(() => {
                setReinstalling(false);
                setReinstallOpen(false);
            });
    };

    const handleScheduleDeletion = () => {
        setScheduling(true);
        clearFlashes('settings');

        scheduleDeletion(server.uuid)
            .then(() => {
                setServer({ ...server, isDeletionScheduled: true });
                addFlash({
                    key: 'settings',
                    type: 'success',
                    message: 'Server scheduled for deletion at the end of the renewal period.',
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'settings', error }))
            .finally(() => {
                setScheduling(false);
                setScheduleOpen(false);
            });
    };

    const handleCancelDeletion = () => {
        setCancelling(true);
        clearFlashes('settings');

        cancelDeletion(server.uuid)
            .then(() => {
                setServer({ ...server, isDeletionScheduled: false });
                addFlash({
                    key: 'settings',
                    type: 'success',
                    message: 'Scheduled deletion canceled. Your server will continue renewing as normal.',
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'settings', error }))
            .finally(() => {
                setCancelling(false);
                setCancelOpen(false);
            });
    };

    let scheduleButtonText = 'Schedule Deletion';
    if (scheduling) {
        scheduleButtonText = 'Scheduling...';
    } else if (server.isDeletionScheduled) {
        scheduleButtonText = 'Deletion Scheduled';
    }

    return (
        <PageContentBlock
            title={'Server Settings'}
            header
            description={'Manage server name, reinstallation, server type, and basic server details.'}
            showFlashKey={'settings'}
        >
            <div css={tw`grid gap-4 lg:grid-cols-3`}>
                <TitledGreyBox title={'General'} icon={faCog}>
                    <Can
                        action={'settings.rename'}
                        renderOnError={
                            <p css={tw`text-sm text-gray-400`}>You do not have permission to rename this server.</p>
                        }
                    >
                        <Formik
                            onSubmit={(values, { setSubmitting }) =>
                                submitRename(values).finally(() => {
                                    setSubmitting(false);
                                })
                            }
                            initialValues={{ name: server.name }}
                            validationSchema={nameSchema}
                        >
                            {({ isSubmitting }) => (
                                <Form>
                                    <Field name={'name'} id={'name'} label={'Server Name'} disabled={!canRename} />
                                    <Button type={'submit'} css={tw`mt-4 w-full`} disabled={isSubmitting || !canRename}>
                                        {isSubmitting ? 'Saving...' : 'Save'}
                                    </Button>
                                </Form>
                            )}
                        </Formik>
                    </Can>
                </TitledGreyBox>

                <Can action={'settings.reinstall'} renderOnError={null}>
                    <TitledGreyBox title={'Server Actions'} icon={faRedo}>
                        {!isStopped && (
                            <Alert type={'warning'} className={'mb-3'}>
                                Server must be stopped first.
                            </Alert>
                        )}
                        <Button.Danger
                            disabled={!isStopped || reinstalling || !canReinstall}
                            onClick={() => setReinstallOpen(true)}
                            css={tw`w-full`}
                        >
                            {reinstalling ? 'Reinstalling...' : 'Reinstall Server'}
                        </Button.Danger>
                        <Dialog.Confirm
                            open={reinstallOpen}
                            title={'Confirm server reinstallation'}
                            confirm={'Yes, reinstall server'}
                            onClose={() => setReinstallOpen(false)}
                            onConfirmed={handleReinstall}
                            buttonType={'danger'}
                        >
                            <div css={tw`text-sm rounded-lg p-4 bg-yellow-500/20 mb-4`}>
                                <p css={tw`font-bold text-yellow-300 mb-2 flex items-center`}>
                                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-2'} />
                                    BACKUP YOUR FILES FIRST
                                </p>
                                <p>
                                    Reinstalling will stop your server and re-run the installation script. Files are
                                    normally not deleted, but corruption is possible. Always backup important data
                                    before continuing.
                                </p>
                            </div>
                            Your server will be stopped and the installation script will be re-run. Are you sure you
                            wish to continue?
                        </Dialog.Confirm>
                        <Button.Danger
                            css={tw`w-full mt-3`}
                            disabled={scheduling || server.isDeletionScheduled}
                            onClick={() => setScheduleOpen(true)}
                        >
                            {scheduleButtonText}
                        </Button.Danger>
                        <Dialog.Confirm
                            open={scheduleOpen}
                            title={'Schedule server deletion?'}
                            confirm={'Yes, schedule deletion'}
                            onClose={() => setScheduleOpen(false)}
                            onConfirmed={handleScheduleDeletion}
                            buttonType={'danger'}
                        >
                            This will mark your server for deletion at the end of its current renewal period. You can
                            cancel before then from this Settings page.
                        </Dialog.Confirm>
                        {server.isDeletionScheduled && (
                            <>
                                <Button css={tw`w-full mt-3`} disabled={cancelling} onClick={() => setCancelOpen(true)}>
                                    {cancelling ? 'Cancelling...' : 'Cancel Scheduled Deletion'}
                                </Button>
                                <Dialog.Confirm
                                    open={cancelOpen}
                                    title={'Cancel scheduled deletion?'}
                                    confirm={'Yes, cancel deletion'}
                                    onClose={() => setCancelOpen(false)}
                                    onConfirmed={handleCancelDeletion}
                                >
                                    This will cancel the scheduled deletion for this server. It will continue to renew
                                    normally unless you schedule deletion again.
                                </Dialog.Confirm>
                            </>
                        )}
                    </TitledGreyBox>
                </Can>

                <TitledGreyBox title={'Server Info'} icon={faInfoCircle}>
                    <div css={tw`space-y-3 text-sm`}>
                        <div>
                            <Label>Server UUID</Label>
                            <CopyOnClick text={server.uuid}>
                                <p css={tw`font-mono text-gray-200 break-all`}>{server.uuid}</p>
                            </CopyOnClick>
                        </div>
                        <div>
                            <Label>Node</Label>
                            <p css={tw`text-gray-200`}>{server.node}</p>
                            {server.nodeId && <p css={tw`font-mono text-gray-300 text-xs`}>Node ID: {server.nodeId}</p>}
                        </div>
                    </div>
                </TitledGreyBox>
                <Can action={'settings.reinstall'} renderOnError={null}>
                    <ChangeEggContainer />
                </Can>
            </div>
        </PageContentBlock>
    );
};
