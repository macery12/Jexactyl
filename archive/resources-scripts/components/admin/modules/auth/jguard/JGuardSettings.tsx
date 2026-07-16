import { useState } from 'react';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import AdminBox from '@/elements/AdminBox';
import Input, { Textarea } from '@/elements/Input';
import useFlash from '@/plugins/useFlash';
import { useStoreActions, useStoreState } from '@/state/hooks';
import useStatus from '@/plugins/useStatus';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { toggleModule } from '@/api/routes/admin/auth/module';
import { updateJGuardSettings, type JGuardSettingsValues } from '@/api/routes/admin/auth/jguard';
import { Alert } from '@/elements/alert';
import { Dialog } from '@/elements/dialog';

export default () => {
    const { status, setStatus } = useStatus();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const auth = useStoreState(state => state.everest.data!.auth);
    const jguard = auth.modules.jguard;
    const updateEverest = useStoreActions(actions => actions.everest.updateEverest);
    const [confirmDisable, setConfirmDisable] = useState(false);

    // Local controlled state — initialized from page-load store, updated immediately on change.
    const [approvalMode, setApprovalMode] = useState<'manual' | 'delayed'>(
        jguard.approval_mode === 'immediate' ? 'manual' : (jguard.approval_mode as 'manual' | 'delayed'),
    );
    const [delay, setDelay] = useState<number>(jguard.delay);
    const [pendingMessage, setPendingMessage] = useState<string>(jguard.pending_message ?? '');

    const saveSetting = (values: JGuardSettingsValues) => {
        clearFlashes('auth:jguard:settings');
        setStatus('loading');
        updateJGuardSettings(values)
            .then(() => {
                setStatus('success');
                updateEverest({
                    auth: {
                        ...auth,
                        modules: {
                            ...auth.modules,
                            jguard: {
                                ...jguard,
                                ...(values.approval_mode != null && {
                                    approval_mode: values.approval_mode as 'manual' | 'delayed',
                                }),
                                ...(values.delay != null && { delay: values.delay }),
                                ...(values.pending_message != null && { pending_message: values.pending_message }),
                            },
                        },
                    },
                });
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'auth:jguard:settings', error });
            });
    };

    const handleModeChange = (value: 'manual' | 'delayed') => {
        setApprovalMode(value);
        saveSetting({ approval_mode: value });
    };

    const handleDelayBlur = (raw: string) => {
        const parsed = Math.max(0, parseInt(raw, 10) || 0);
        setDelay(parsed);
        saveSetting({ delay: parsed });
    };

    const handlePendingMessageBlur = (value: string) => {
        saveSetting({ pending_message: value });
    };

    const doDisable = () => {
        toggleModule('disable', 'jguard')
            .then(() => {
                // @ts-expect-error navigation redirect
                window.location = '/admin/auth';
            })
            .catch(error => clearAndAddHttpError({ key: 'auth:jguard:settings', error }));
    };

    return (
        <div className={'space-y-6'}>
            <Dialog.Confirm
                open={confirmDisable}
                title={'Disable jGuard'}
                onConfirmed={() => doDisable()}
                onClose={() => setConfirmDisable(false)}
            >
                Are you sure you want to disable jGuard? Pending accounts will not be automatically approved.
            </Dialog.Confirm>

            <AdminBox title={'jGuard Settings'} icon={faShieldHalved} byKey={'auth:jguard:settings'} status={status}>
                <div>
                    <Label>Approval Mode</Label>
                    <Select
                        id={'approval_mode'}
                        name={'approval_mode'}
                        value={approvalMode}
                        onChange={e => handleModeChange(e.target.value as 'manual' | 'delayed')}
                        autoComplete={'off'}
                    >
                        <option value={'manual'}>Manual — Admin must approve each account</option>
                        <option value={'delayed'}>Delayed — Accounts activate after a set time</option>
                    </Select>
                    <p className={'mt-1 text-xs text-gray-400'}>
                        Controls how new registrations are processed when jGuard is enabled.
                    </p>
                </div>

                {approvalMode === 'delayed' && (
                    <div className={'mt-6'}>
                        <Label>Activation Delay (minutes)</Label>
                        <Input
                            autoComplete={'off'}
                            id={'delay'}
                            type={'number'}
                            name={'delay'}
                            min={0}
                            value={delay}
                            onChange={e => setDelay(parseInt(e.target.value, 10) || 0)}
                            onBlur={e => handleDelayBlur(e.target.value)}
                        />
                        <p className={'mt-1 text-xs text-gray-400'}>
                            How many minutes a newly registered account must wait before it is automatically activated.
                            Currently set to{' '}
                            <strong>
                                {delay === 0
                                    ? '0 minutes (instant)'
                                    : delay < 60
                                      ? `${delay} minute${delay !== 1 ? 's' : ''}`
                                      : delay % 60 === 0
                                        ? `${delay / 60} hour${delay / 60 !== 1 ? 's' : ''}`
                                        : `${Math.floor(delay / 60)}h ${delay % 60}m`}
                            </strong>
                            .
                        </p>
                    </div>
                )}

                <div className={'mt-6'}>
                    <Label>Pending Approval Message</Label>
                    <Textarea
                        id={'pending_message'}
                        name={'pending_message'}
                        rows={3}
                        maxLength={500}
                        placeholder={
                            'Your account is pending approval. An administrator will review your registration shortly.'
                        }
                        value={pendingMessage}
                        onChange={e => setPendingMessage(e.target.value)}
                        onBlur={e => handlePendingMessageBlur(e.target.value)}
                    />
                    <p className={'mt-1 text-xs text-gray-400'}>
                        The message shown to users whose accounts are awaiting approval. Leave blank to use the default
                        message.
                    </p>
                </div>

                <div className={'mt-6 border-t border-neutral-700 pt-5'}>
                    <button
                        className={
                            'inline-flex items-center gap-1.5 rounded border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-400 hover:bg-red-500/20 hover:text-red-300'
                        }
                        onClick={() => setConfirmDisable(true)}
                    >
                        Disable jGuard module
                    </button>
                </div>
            </AdminBox>

            {approvalMode === 'manual' && (
                <Alert type={'info'}>
                    <span className={'text-xs'}>
                        Manual approval mode is active. New registrations will be held until you approve them from the{' '}
                        <strong>Pending Accounts</strong> tab.
                    </span>
                </Alert>
            )}

            {approvalMode === 'delayed' && (
                <Alert type={'info'}>
                    <span className={'text-xs'}>
                        Delayed activation mode is active. New accounts are held for{' '}
                        <strong>
                            {delay === 0
                                ? '0 minutes'
                                : delay < 60
                                  ? `${delay} minute${delay !== 1 ? 's' : ''}`
                                  : delay % 60 === 0
                                    ? `${delay / 60} hour${delay / 60 !== 1 ? 's' : ''}`
                                    : `${Math.floor(delay / 60)}h ${delay % 60}m`}
                        </strong>{' '}
                        before they automatically gain access.
                    </span>
                </Alert>
            )}
        </div>
    );
};
