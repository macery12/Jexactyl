import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import http from '@/api/http';
import { ServerContext } from '@/state/server';
import { type Mod } from '@/api/routes/server/mods';
import {
    type ModpackVersion,
    type ModpackPreview,
    type ModpackLoaderStatus,
    installModpack,
    getModpackLoaderStatus,
} from '@/api/routes/server/modpacks';
import Spinner from '@/elements/Spinner';
import Input from '@/elements/Input';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faTriangleExclamation, faCheck } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

interface Props {
    modpack: Mod;
    version: ModpackVersion;
    preview: ModpackPreview;
    onClose: () => void;
    onInstalled: () => void;
}

type Step = 'wipe' | 'loader' | 'confirm';

export default function ModpackInstallWizard({ modpack, version, preview, onClose, onInstalled }: Props) {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const serverName = ServerContext.useStoreState(state => state.server.data!.name);
    const { colors } = useStoreState(state => state.theme.data!);

    // Full-wipe state — gated behind a typed confirmation.
    const [wipeArmed, setWipeArmed] = useState(false);
    const [wipeTyped, setWipeTyped] = useState('');
    const [backupCount, setBackupCount] = useState<number | null>(null);

    // Loader state.
    const [loaderStatus, setLoaderStatus] = useState<ModpackLoaderStatus | null>(null);
    const [installLoader, setInstallLoader] = useState(true);

    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState<string | null>(null);
    const [installed, setInstalled] = useState(false);

    const requiredLoader = preview.required_loader ?? preview.loader ?? null;
    const wipeServer = wipeArmed && wipeTyped.trim() === serverName;

    useEffect(() => {
        http.get(`/api/client/servers/${uuid}/backups`)
            .then(r => setBackupCount(r.data?.meta?.backup_count ?? 0))
            .catch(() => setBackupCount(null));

        getModpackLoaderStatus(uuid)
            .then(status => {
                setLoaderStatus(status);
                // Default the loader install on unless the right loader is already present.
                setInstallLoader(!(status.has_loader && status.detected === requiredLoader));
            })
            .catch(() => setLoaderStatus({ has_loader: false, detected: null }));
    }, [uuid]);

    const steps: Step[] = ['wipe', 'loader', 'confirm'];
    const [stepIndex, setStepIndex] = useState(0);
    const currentStep = steps[stepIndex];

    const goNext = () => setStepIndex(i => Math.min(i + 1, steps.length - 1));
    const goBack = () => setStepIndex(i => Math.max(i - 1, 0));

    const handleInstall = () => {
        setInstallError(null);
        setInstalling(true);
        installModpack(uuid, modpack.id, version.id, {
            project_id: modpack.id,
            file_id: version.id,
            modpack_name: modpack.name,
            wipe_server: wipeServer,
            install_loader: installLoader,
        })
            .then(() => {
                setInstalled(true);
                setTimeout(onInstalled, 1800);
            })
            .catch(e => setInstallError(e?.response?.data?.error ?? 'Failed to queue modpack install.'))
            .finally(() => setInstalling(false));
    };

    return (
        <>
            <div css={tw`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm`} onClick={onClose} />

            <div css={tw`fixed inset-0 z-50 flex items-center justify-center p-4`} onClick={e => e.stopPropagation()}>
                <div
                    css={tw`bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`}
                >
                    {/* Header */}
                    <div css={tw`flex items-center justify-between px-6 py-4 border-b border-neutral-700`}>
                        <div>
                            <h2 css={tw`text-base font-bold text-neutral-100`}>Install {modpack.name}</h2>
                            <p css={tw`text-xs text-neutral-500 mt-0.5`}>
                                Step {stepIndex + 1} of {steps.length}
                                {' · '}
                                <span css={tw`capitalize`}>{currentStep}</span>
                            </p>
                        </div>
                        <button css={tw`text-neutral-400 hover:text-neutral-200 transition-colors`} onClick={onClose}>
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>

                    {/* Step progress bar */}
                    <div css={tw`h-1 bg-neutral-800`}>
                        <div
                            css={tw`h-full transition-all duration-300`}
                            style={{
                                width: `${((stepIndex + 1) / steps.length) * 100}%`,
                                backgroundColor: colors.primary,
                            }}
                        />
                    </div>

                    {/* Step content */}
                    <div css={tw`p-6`}>
                        {installed ? (
                            <div css={tw`text-center py-8`}>
                                <FontAwesomeIcon icon={faCheck} css={tw`text-green-400 text-4xl mb-4`} />
                                <p css={tw`text-lg font-semibold text-neutral-100`}>Install queued!</p>
                                <p css={tw`text-sm text-neutral-400 mt-2`}>
                                    The modpack is installing on your server. Watch the Queue tab for progress.
                                </p>
                            </div>
                        ) : currentStep === 'wipe' ? (
                            <StepWipe
                                serverName={serverName}
                                backupCount={backupCount}
                                wipeArmed={wipeArmed}
                                wipeTyped={wipeTyped}
                                wipeServer={wipeServer}
                                onToggleArmed={setWipeArmed}
                                onChangeTyped={setWipeTyped}
                            />
                        ) : currentStep === 'loader' ? (
                            <StepLoader
                                status={loaderStatus}
                                requiredLoader={requiredLoader}
                                minecraftVersion={preview.minecraft_version}
                                installLoader={installLoader}
                                onChange={setInstallLoader}
                            />
                        ) : currentStep === 'confirm' ? (
                            <StepConfirm
                                modpack={modpack}
                                version={version}
                                preview={preview}
                                wipeServer={wipeServer}
                                installLoader={installLoader}
                                requiredLoader={requiredLoader}
                                installing={installing}
                                installError={installError}
                                onInstall={handleInstall}
                            />
                        ) : null}
                    </div>

                    {/* Navigation */}
                    {!installed && currentStep !== 'confirm' && (
                        <div css={tw`flex items-center justify-between px-6 pb-5`}>
                            <button
                                type="button"
                                css={tw`px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-40`}
                                disabled={stepIndex === 0}
                                onClick={goBack}
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                css={tw`px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                                style={{ backgroundColor: colors.primary, color: '#fff' }}
                                onClick={goNext}
                                disabled={currentStep === 'wipe' && wipeArmed && !wipeServer}
                            >
                                Next
                            </button>
                        </div>
                    )}

                    {!installed && currentStep === 'confirm' && (
                        <div css={tw`px-6 pb-5`}>
                            <button
                                type="button"
                                css={tw`text-sm text-neutral-400 hover:text-neutral-200 transition-colors`}
                                onClick={goBack}
                            >
                                ← Back
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Step: Full-server wipe ─────────────────────────────────────────────────

function StepWipe({
    serverName,
    backupCount,
    wipeArmed,
    wipeTyped,
    wipeServer,
    onToggleArmed,
    onChangeTyped,
}: {
    serverName: string;
    backupCount: number | null;
    wipeArmed: boolean;
    wipeTyped: string;
    wipeServer: boolean;
    onToggleArmed: (v: boolean) => void;
    onChangeTyped: (v: string) => void;
}) {
    return (
        <div>
            <p css={tw`text-sm font-medium text-neutral-200 mb-2`}>Clean install</p>
            <p css={tw`text-xs text-neutral-500 mb-4`}>
                For the most reliable result, wipe the entire server before installing the modpack. This removes{' '}
                <strong>all</strong> existing files — worlds, configs and mods. Leave this off to install on top of your
                current files.
            </p>

            {/* Backup nudge */}
            {backupCount === 0 && (
                <div className={'flex items-start gap-3 p-4 rounded-lg border border-amber-700 bg-amber-900 mb-4'}>
                    <FontAwesomeIcon icon={faTriangleExclamation} className={'text-amber-400 mt-0.5 flex-shrink-0'} />
                    <p className={'text-xs text-amber-300'}>
                        You have <strong>no backups</strong>. A wipe cannot be undone — create one from the Backups tab
                        first if you need to keep your current world or configs.
                    </p>
                </div>
            )}
            {!!backupCount && backupCount > 0 && (
                <p css={tw`text-xs text-neutral-500 mb-4`}>
                    You have {backupCount} backup{backupCount === 1 ? '' : 's'}. A wipe still cannot be undone.
                </p>
            )}

            <label css={tw`flex items-start gap-3 cursor-pointer`}>
                <input
                    type="checkbox"
                    checked={wipeArmed}
                    onChange={e => onToggleArmed(e.target.checked)}
                    css={tw`mt-0.5 rounded border-neutral-600 bg-neutral-800 text-red-500 flex-shrink-0`}
                />
                <span>
                    <span css={tw`text-sm font-medium text-neutral-200 block`}>Wipe the entire server first</span>
                    <span css={tw`text-xs text-neutral-500`}>Deletes everything in the server before installing.</span>
                </span>
            </label>

            {wipeArmed && (
                <div css={tw`mt-4 rounded-lg border border-red-700 bg-red-900/30 p-4`}>
                    <p css={tw`text-xs text-red-300 mb-2`}>
                        This permanently deletes all files. To confirm, type the server name{' '}
                        <span css={tw`font-mono text-red-200`}>{serverName}</span> below:
                    </p>
                    <Input
                        value={wipeTyped}
                        onChange={e => onChangeTyped(e.currentTarget.value)}
                        placeholder={serverName}
                        hasError={wipeTyped.length > 0 && !wipeServer}
                    />
                    {wipeServer && <p css={tw`text-xs text-red-300 mt-2`}>✓ Full wipe armed.</p>}
                </div>
            )}
        </div>
    );
}

// ─── Step: Loader detection + install ──────────────────────────────────────

function StepLoader({
    status,
    requiredLoader,
    minecraftVersion,
    installLoader,
    onChange,
}: {
    status: ModpackLoaderStatus | null;
    requiredLoader: string | null;
    minecraftVersion: string | null;
    installLoader: boolean;
    onChange: (v: boolean) => void;
}) {
    if (status === null) {
        return (
            <div css={tw`py-6`}>
                <Spinner size="small" centered />
                <p css={tw`text-xs text-neutral-500 text-center mt-3`}>Checking for an installed mod loader…</p>
            </div>
        );
    }

    const alreadyInstalled = status.has_loader && status.detected === requiredLoader;

    return (
        <div>
            <p css={tw`text-sm font-medium text-neutral-200 mb-3`}>Mod Loader</p>

            {alreadyInstalled ? (
                <div className={'flex items-start gap-3 p-4 rounded-lg border border-green-800 bg-green-900/30 mb-4'}>
                    <FontAwesomeIcon icon={faCheck} className={'text-green-400 mt-0.5 flex-shrink-0'} />
                    <p className={'text-xs text-green-300'}>
                        <span css={tw`capitalize`}>{status.detected}</span> is already installed on this server. You can
                        reinstall it below if you want a fresh copy.
                    </p>
                </div>
            ) : (
                <div className={'flex items-start gap-3 p-4 rounded-lg border border-amber-700 bg-amber-900 mb-4'}>
                    <FontAwesomeIcon icon={faTriangleExclamation} className={'text-amber-400 mt-0.5 flex-shrink-0'} />
                    <div>
                        <p className={'text-xs text-amber-300 mb-1'}>
                            {status.detected
                                ? `This server has ${status.detected} installed, but this modpack needs ${requiredLoader}.`
                                : 'No matching mod loader is installed on this server.'}
                        </p>
                        <p className={'text-xs text-amber-400'}>
                            This pack needs <strong css={tw`capitalize`}>{requiredLoader}</strong>
                            {minecraftVersion ? ` for Minecraft ${minecraftVersion}` : ''}.
                        </p>
                    </div>
                </div>
            )}

            <label css={tw`flex items-start gap-3 cursor-pointer`}>
                <input
                    type="checkbox"
                    checked={installLoader}
                    onChange={e => onChange(e.target.checked)}
                    css={tw`mt-0.5 rounded border-neutral-600 bg-neutral-800 text-blue-500 flex-shrink-0`}
                />
                <span>
                    <span css={tw`text-sm font-medium text-neutral-200 block`}>
                        {alreadyInstalled ? 'Reinstall' : 'Install'} <span css={tw`capitalize`}>{requiredLoader}</span>
                        {minecraftVersion ? ` for Minecraft ${minecraftVersion}` : ''}
                    </span>
                    <span css={tw`text-xs text-neutral-500`}>
                        We&apos;ll set the server&apos;s startup command and Java version automatically.
                    </span>
                </span>
            </label>
        </div>
    );
}

// ─── Step: Confirm ─────────────────────────────────────────────────────────

function StepConfirm({
    modpack,
    version,
    preview,
    wipeServer,
    installLoader,
    requiredLoader,
    installing,
    installError,
    onInstall,
}: {
    modpack: Mod;
    version: ModpackVersion;
    preview: ModpackPreview;
    wipeServer: boolean;
    installLoader: boolean;
    requiredLoader: string | null;
    installing: boolean;
    installError: string | null;
    onInstall: () => void;
}) {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div>
            <p css={tw`text-sm font-medium text-neutral-200 mb-4`}>Ready to Install</p>

            <div css={tw`bg-neutral-800 rounded-lg p-4 space-y-2 text-sm mb-5`}>
                <Row label="Modpack" value={modpack.name} />
                <Row label="Version" value={version.name} />
                {preview.minecraft_version && <Row label="Minecraft" value={preview.minecraft_version} />}
                {requiredLoader && <Row label="Loader" value={requiredLoader} capitalize />}
                <Row label="Install loader" value={installLoader ? 'Yes' : 'No'} />
                {wipeServer && <Row label="⚠ Will delete" value="entire server" danger />}
            </div>

            <p css={tw`text-xs text-neutral-500 mb-5`}>
                The pack and all its mods are downloaded directly onto your server. This runs in the background — follow
                along in the Queue tab.
            </p>

            {installError && (
                <p css={tw`text-sm text-red-400 bg-red-900 border border-red-700 rounded px-3 py-2 mb-4`}>
                    {installError}
                </p>
            )}

            <button
                type="button"
                disabled={installing}
                onClick={onInstall}
                css={tw`w-full py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                style={{ backgroundColor: colors.primary, color: '#fff' }}
            >
                {installing ? (
                    <span css={tw`flex items-center justify-center gap-2`}>
                        <Spinner size="small" />
                        Queuing install…
                    </span>
                ) : (
                    'Install Modpack'
                )}
            </button>
        </div>
    );
}

function Row({
    label,
    value,
    danger,
    capitalize,
}: {
    label: string;
    value: string;
    danger?: boolean;
    capitalize?: boolean;
}) {
    return (
        <div css={tw`flex items-start justify-between gap-4`}>
            <span css={tw`text-neutral-500 flex-shrink-0`}>{label}</span>
            <span css={[tw`text-neutral-200 text-right`, danger && tw`text-red-400`, capitalize && tw`capitalize`]}>
                {value}
            </span>
        </div>
    );
}
