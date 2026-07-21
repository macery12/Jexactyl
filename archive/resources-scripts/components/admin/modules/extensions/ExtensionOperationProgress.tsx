import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import Spinner from '@/elements/Spinner';
import { InstallProgress, getInstallProgress } from '@/api/routes/admin/extensions';

const POLL_INTERVAL_MS = 1500;
/** How long (ms) to show the "completed" state before the banner dismisses. */
const COMPLETION_DISPLAY_DURATION = 5000;

type StepName =
    | 'downloading'
    | 'extracting'
    | 'validating'
    | 'copying'
    | 'optimizing'
    | 'building'
    | 'registering'
    | 'removing';

const INSTALL_STEPS: StepName[] = [
    'downloading',
    'extracting',
    'validating',
    'copying',
    'optimizing',
    'building',
    'registering',
];

const UNINSTALL_STEPS: StepName[] = ['validating', 'removing', 'optimizing', 'building', 'registering'];

const UPDATE_STEPS: StepName[] = [
    'downloading',
    'extracting',
    'validating',
    'removing',
    'copying',
    'optimizing',
    'building',
    'registering',
];

const STEP_LABELS: Record<string, string> = {
    downloading: 'Downloading',
    extracting: 'Extracting',
    validating: 'Validating',
    copying: 'Copying files',
    optimizing: 'Optimizing',
    building: 'Building panel',
    registering: 'Registering',
    removing: 'Removing files',
};

function getStepsForAction(action: string): StepName[] {
    if (action.includes('uninstall')) return UNINSTALL_STEPS;
    if (action.includes('update')) return UPDATE_STEPS;
    return INSTALL_STEPS;
}

function getActionVerb(action: string): string {
    if (action.includes('uninstall')) return 'Uninstalling';
    if (action.includes('update')) return 'Updating';
    return 'Installing';
}

/** Renders the step-dot row shared by single and per-extension batch views. */
function StepDots({ steps, currentStage }: { steps: StepName[]; currentStage: string }) {
    const currentStageIndex = steps.indexOf(currentStage as StepName);
    return (
        <div className={'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1'}>
            {steps.map((step, index) => {
                const isActive = step === currentStage;
                const isDone = currentStageIndex > index;
                return (
                    <span key={step} className={'flex items-center gap-1'}>
                        <span
                            className={classNames(
                                'inline-block h-1.5 w-1.5 rounded-full transition-colors duration-300',
                                isActive && 'bg-white',
                                isDone && !isActive && 'bg-neutral-500',
                                !isDone && !isActive && 'bg-neutral-700',
                            )}
                        />
                        <span
                            className={classNames(
                                'text-xs transition-colors duration-300',
                                isActive && 'text-neutral-100',
                                isDone && !isActive && 'text-neutral-500',
                                !isDone && !isActive && 'text-neutral-700',
                            )}
                        >
                            {STEP_LABELS[step]}
                        </span>
                    </span>
                );
            })}
        </div>
    );
}

type DisplayState = 'idle' | 'active' | 'completed';

/**
 * Persistent extension operation progress banner.
 *
 * Polls the /progress endpoint on mount so it immediately shows the current
 * state even after a page refresh. Handles single and batch operations.
 * Renders nothing when idle.
 */
export default () => {
    const { colors } = useStoreState(state => state.theme.data!);

    const [displayState, setDisplayState] = useState<DisplayState>('idle');
    const [progress, setProgress] = useState<InstallProgress | null>(null);

    const prevHadProgressRef = useRef(false);
    const lastProgressRef = useRef<InstallProgress | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const handleResult = (p: InstallProgress | null) => {
            if (p) {
                lastProgressRef.current = p;
                prevHadProgressRef.current = true;

                if (dismissTimerRef.current !== null) {
                    clearTimeout(dismissTimerRef.current);
                    dismissTimerRef.current = null;
                }

                setProgress(p);
                setDisplayState('active');
            } else if (prevHadProgressRef.current) {
                prevHadProgressRef.current = false;
                setProgress(null);

                if (lastProgressRef.current?.stage === 'completed') {
                    setDisplayState('completed');
                    dismissTimerRef.current = setTimeout(() => {
                        setDisplayState('idle');
                        dismissTimerRef.current = null;
                    }, COMPLETION_DISPLAY_DURATION);
                } else {
                    setDisplayState('idle');
                }
            }
        };

        // Check immediately on mount so a refresh mid-operation shows the banner right away.
        getInstallProgress()
            .then(handleResult)
            .catch(() => {});

        pollRef.current = setInterval(() => {
            getInstallProgress()
                .then(handleResult)
                .catch(() => {});
        }, POLL_INTERVAL_MS);

        return () => {
            if (pollRef.current !== null) clearInterval(pollRef.current);
            if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
        };
    }, []);

    if (displayState === 'idle') return null;

    const primary = colors.primary;
    const alpha = (hex: string, opacity: string) => `${hex}${opacity}`;

    // ─── Completed state ───────────────────────────────────────────────────────
    if (displayState === 'completed') {
        return (
            <div
                className={'mb-4 rounded-lg border p-4'}
                style={{ backgroundColor: alpha('#22c55e', '15'), borderColor: '#22c55e55' }}
            >
                <div className={'flex items-center gap-3'}>
                    <FontAwesomeIcon icon={faCheck} className={'text-green-400'} />
                    <span className={'text-sm font-semibold text-green-300'}>Operation completed</span>
                </div>
            </div>
        );
    }

    // ─── Active state ──────────────────────────────────────────────────────────
    if (!progress) return null;

    const isBatch = progress.action.startsWith('batch-');
    const verb = getActionVerb(progress.action);
    const steps = getStepsForAction(progress.action);

    // ─── Single operation ──────────────────────────────────────────────────────
    if (!isBatch) {
        return (
            <div
                className={'mb-4 rounded-lg border p-4'}
                style={{ backgroundColor: alpha(primary, '10'), borderColor: alpha(primary, '55') }}
            >
                <div className={'flex items-center gap-3'}>
                    <Spinner size={'small'} />
                    <div className={'flex-1 min-w-0'}>
                        <p className={'text-sm font-semibold text-neutral-100'}>
                            {verb} {progress.extension_id}
                        </p>
                    </div>
                    <span
                        className={'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium'}
                        style={{ backgroundColor: alpha(primary, '20'), color: primary }}
                    >
                        {STEP_LABELS[progress.stage] ?? progress.stage}
                        {progress.stage !== 'completed' && '…'}
                    </span>
                </div>
                {steps.length > 0 && <StepDots steps={steps} currentStage={progress.stage} />}
            </div>
        );
    }

    // ─── Batch operation ───────────────────────────────────────────────────────
    const total = progress.batch_total ?? 1;
    const currentIndex = (progress.batch_current ?? 1) - 1; // 0-based
    const batchExtensions = progress.batch_extensions ?? [progress.extension_id];

    // After all file-prep steps the service reports batch_current === batch_total for
    // the shared rebuild/register/complete phases. In those phases every extension is
    // "done" from a per-item perspective, so we treat it as a post-loop stage.
    const isSharedPhase = ['optimizing', 'building', 'registering', 'completed'].includes(progress.stage);

    return (
        <div
            className={'mb-4 rounded-lg border p-4'}
            style={{ backgroundColor: alpha(primary, '10'), borderColor: alpha(primary, '55') }}
        >
            {/* Header */}
            <div className={'flex items-center gap-3'}>
                <Spinner size={'small'} />
                <p className={'flex-1 min-w-0 text-sm font-semibold text-neutral-100'}>
                    {verb} {total} extension{total === 1 ? '' : 's'}:
                </p>
                <span
                    className={'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium'}
                    style={{ backgroundColor: alpha(primary, '20'), color: primary }}
                >
                    {STEP_LABELS[progress.stage] ?? progress.stage}
                    {progress.stage !== 'completed' && '…'}
                </span>
            </div>

            {/* Per-extension list */}
            <ol className={'mt-3 space-y-2'}>
                {batchExtensions.map((extId, idx) => {
                    const isDone = isSharedPhase || idx < currentIndex;
                    const isActive = !isSharedPhase && idx === currentIndex;
                    const isPending = !isSharedPhase && idx > currentIndex;

                    return (
                        <li key={extId}>
                            <div className={'flex items-center gap-2'}>
                                {/* Status icon */}
                                <span className={'flex h-4 w-4 shrink-0 items-center justify-center'}>
                                    {isDone ? (
                                        <FontAwesomeIcon icon={faCheck} className={'text-xs text-green-400'} />
                                    ) : isActive ? (
                                        <Spinner size={'small'} />
                                    ) : (
                                        <span className={'inline-block h-1.5 w-1.5 rounded-full bg-neutral-700'} />
                                    )}
                                </span>

                                {/* Extension label */}
                                <span
                                    className={classNames('text-xs font-mono transition-colors duration-300', {
                                        'text-neutral-100': isActive,
                                        'text-neutral-500': isDone,
                                        'text-neutral-600': isPending,
                                    })}
                                >
                                    {idx + 1}: {extId}
                                </span>
                            </div>

                            {/* Step dots appear under the currently-active extension */}
                            {isActive && steps.length > 0 && (
                                <div className={'ml-6'}>
                                    <StepDots steps={steps} currentStage={progress.stage} />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>

            {/* Shared-phase step dots (optimizing / building / registering) shown below the list */}
            {isSharedPhase && progress.stage !== 'completed' && steps.length > 0 && (
                <div className={'mt-3'}>
                    <StepDots steps={steps} currentStage={progress.stage} />
                </div>
            )}
        </div>
    );
};
