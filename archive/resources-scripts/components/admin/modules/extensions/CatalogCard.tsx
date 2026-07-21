import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faBell,
    faBolt,
    faChartLine,
    faCloud,
    faCogs,
    faCube,
    faDatabase,
    faFile,
    faFolder,
    faGamepad,
    faGlobe,
    faKey,
    faLock,
    faPuzzlePiece,
    faRobot,
    faScroll,
    faServer,
    faShieldHalved,
    faTerminal,
    faToggleOff,
    faToggleOn,
    faUsers,
    faWrench,
    faLink,
    faDownload,
    faTrash,
    faCog,
    faTriangleExclamation,
    faCheck,
    faArrowsRotate,
} from '@fortawesome/free-solid-svg-icons';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { Button } from '@/elements/button';
import Modal from '@/elements/Modal';
import Input, { Textarea } from '@/elements/Input';
import Select from '@/elements/Select';
import Spinner from '@/elements/Spinner';
import useFlash from '@/plugins/useFlash';
import {
    EggOption,
    ExtensionData,
    ExtensionSettingField,
    NestOption,
    getNestsAndEggs,
    installExtension,
    toggleExtension,
    uninstallExtension,
    updateExtension,
    upgradeExtension,
} from '@/api/routes/admin/extensions';

interface PackageActionState {
    extensionId: string;
    extensionName: string;
    type: 'install' | 'uninstall' | 'update';
}

interface Props {
    extension: ExtensionData;
    currentPanelVersion?: string;
    activePackageAction: PackageActionState | null;
    isOperationRunning?: boolean;
    isSelected?: boolean;
    onToggleSelect?: () => void;
    onRefresh: () => void;
    onPackageActionStart: (action: PackageActionState) => void;
    onPackageActionEnd: (extensionId: string) => void;
}

const iconMap: Record<string, typeof faPuzzlePiece> = {
    puzzle: faPuzzlePiece,
    users: faUsers,
    gamepad: faGamepad,
    cube: faCube,
    server: faServer,
    discord: faDiscord,
    link: faLink,
    wrench: faWrench,
    shield: faShieldHalved,
    terminal: faTerminal,
    globe: faGlobe,
    database: faDatabase,
    chart: faChartLine,
    bell: faBell,
    robot: faRobot,
    cloud: faCloud,
    folder: faFolder,
    file: faFile,
    key: faKey,
    bolt: faBolt,
    cogs: faCogs,
    lock: faLock,
    scroll: faScroll,
};

export default ({
    extension,
    currentPanelVersion,
    activePackageAction,
    isOperationRunning = false,
    isSelected = false,
    onToggleSelect,
    onRefresh,
    onPackageActionStart,
    onPackageActionEnd,
}: Props) => {
    const { colors } = useStoreState(state => state.theme.data!);
    const primary = colors.primary;
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();

    const [loading, setLoading] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [nestsAndEggs, setNestsAndEggs] = useState<{ nests: NestOption[]; eggs: EggOption[] } | null>(null);
    const [selectedNests, setSelectedNests] = useState<number[]>(extension.allowedNests || []);
    const [selectedEggs, setSelectedEggs] = useState<number[]>(extension.allowedEggs || []);
    const [settings, setSettings] = useState<Record<string, unknown>>(extension.settings || {});

    const icon = iconMap[extension.icon] || faPuzzlePiece;
    const manageable = Boolean(extension.installed) || extension.status === 'core';
    const compatiblePanelVersions = useMemo(
        () =>
            (extension.compatiblePanelVersions ?? []).filter((version): version is string => version.trim().length > 0),
        [extension.compatiblePanelVersions],
    );
    const hasPanelRestrictions = compatiblePanelVersions.length > 0;
    const canEvaluatePanelCompatibility = Boolean(currentPanelVersion);
    const currentPanelSupported =
        !hasPanelRestrictions || !currentPanelVersion || compatiblePanelVersions.includes(currentPanelVersion);
    const installBlockedByPanelVersion =
        Boolean(extension.installable && extension.source?.repositoryId) &&
        hasPanelRestrictions &&
        canEvaluatePanelCompatibility &&
        !currentPanelSupported;
    const compatibilityHeading = !hasPanelRestrictions
        ? 'Compatible with any panel version'
        : installBlockedByPanelVersion
          ? 'Unsupported on this panel version'
          : canEvaluatePanelCompatibility
            ? 'Supports the current panel version'
            : 'Declared supported panel versions';
    const compatibilityMessage = !hasPanelRestrictions
        ? 'This package does not declare panel version restrictions.'
        : installBlockedByPanelVersion
          ? extension.installable
              ? `This package cannot be installed on panel ${currentPanelVersion}. Install is blocked until the panel version matches one of the supported releases below.`
              : `This installed package does not list panel ${currentPanelVersion} as supported. Update the panel or package if you see compatibility issues.`
          : canEvaluatePanelCompatibility
            ? `Panel ${currentPanelVersion} is included in this package's supported version list.`
            : 'This package declares support for the panel versions listed below.';
    const alpha = (color: string, opacity: string) => `${color}${opacity}`;
    const cardStyle = { backgroundColor: colors.secondary, borderColor: colors.headers };
    const surfaceStyle = { backgroundColor: colors.background, borderColor: colors.headers };
    const accentSurfaceStyle = { backgroundColor: alpha(primary, '10'), borderColor: primary };
    const accentPillStyle = {
        backgroundColor: alpha(primary, '16'),
        borderColor: alpha(primary, '55'),
        color: primary,
    };
    const neutralPillStyle = { backgroundColor: colors.background, borderColor: colors.headers };
    const statusPillStyle = extension.status === 'core' ? accentPillStyle : neutralPillStyle;
    const enabledPillStyle = extension.enabled ? accentPillStyle : neutralPillStyle;
    const updatePillStyle = accentPillStyle;
    const compatibilityBoxStyle = installBlockedByPanelVersion
        ? { ...accentSurfaceStyle, borderStyle: 'dashed' }
        : surfaceStyle;
    const anotherPackageActionInProgress =
        isOperationRunning || (activePackageAction !== null && activePackageAction.extensionId !== extension.id);
    let packageActionNotice: string | null = null;
    if (anotherPackageActionInProgress) {
        packageActionNotice =
            activePackageAction !== null
                ? `Wait for ${activePackageAction.extensionName} to finish ${
                      activePackageAction.type === 'install' ? 'installing' : 'uninstalling'
                  } before starting another extension install or uninstall.`
                : 'An extension operation is already running. Wait for it to finish before starting another install, update, or uninstall.';
    }

    useEffect(() => {
        if (!configOpen || nestsAndEggs) {
            return;
        }

        getNestsAndEggs()
            .then(data => setNestsAndEggs(data))
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }));
    }, [configOpen, nestsAndEggs]);

    useEffect(() => {
        if (!configOpen) {
            return;
        }

        setSelectedNests(extension.allowedNests || []);
        setSelectedEggs(extension.allowedEggs || []);
        setSettings(extension.settings || {});
    }, [configOpen, extension.allowedEggs, extension.allowedNests, extension.settings]);

    const filteredEggs = useMemo(
        () => nestsAndEggs?.eggs.filter(egg => selectedNests.length === 0 || selectedNests.includes(egg.nestId)) ?? [],
        [nestsAndEggs, selectedNests],
    );

    const updateSetting = (key: string, value: unknown) => {
        setSettings(current => ({ ...current, [key]: value }));
    };

    const handleToggle = () => {
        setLoading(true);
        clearFlashes('admin:extensions');

        toggleExtension(extension.id)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} has been ${
                        extension.enabled ? 'disabled' : 'enabled'
                    } for eligible servers.`,
                });
                onRefresh();
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }))
            .finally(() => setLoading(false));
    };

    const handleInstall = () => {
        if (packageActionNotice) {
            clearFlashes('admin:extensions');
            addFlash({
                key: 'admin:extensions',
                type: 'warning',
                message: packageActionNotice,
            });

            return;
        }

        if (!extension.source?.repositoryId) {
            return;
        }

        const confirmed = window.confirm(
            extension.source.official
                ? `Install ${extension.name} from ${extension.source.label}?`
                : `Install ${extension.name} from ${extension.source.label}? Third-party repositories can execute arbitrary PHP and frontend code inside M12Labs.`,
        );

        if (!confirmed) {
            return;
        }

        setLoading(true);
        clearFlashes('admin:extensions');
        onPackageActionStart({ extensionId: extension.id, extensionName: extension.name, type: 'install' });

        installExtension(extension.id, extension.source.repositoryId)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} was installed and M12Labs was rebuilt.`,
                });
                onRefresh();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => {
                setLoading(false);
                onPackageActionEnd(extension.id);
            });
    };

    const handleUninstall = () => {
        if (packageActionNotice) {
            clearFlashes('admin:extensions');
            addFlash({
                key: 'admin:extensions',
                type: 'warning',
                message: packageActionNotice,
            });

            return;
        }

        if (!extension.canUninstall) {
            return;
        }

        const confirmed = window.confirm(
            `Uninstall ${extension.name}? This restores the files it added to M12Labs and rebuilds the panel.`,
        );

        if (!confirmed) {
            return;
        }

        setLoading(true);
        clearFlashes('admin:extensions');
        onPackageActionStart({ extensionId: extension.id, extensionName: extension.name, type: 'uninstall' });

        uninstallExtension(extension.id)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} was uninstalled and M12Labs was rebuilt.`,
                });
                onRefresh();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => {
                setLoading(false);
                onPackageActionEnd(extension.id);
            });
    };

    const handleUpdate = () => {
        if (packageActionNotice) {
            clearFlashes('admin:extensions');
            addFlash({
                key: 'admin:extensions',
                type: 'warning',
                message: packageActionNotice,
            });

            return;
        }

        if (!extension.updateAvailable || !extension.source?.repositoryId) {
            return;
        }

        const confirmed = window.confirm(
            `Update ${extension.name} from v${extension.version} to v${
                extension.latestVersion ?? 'latest'
            }? The panel will be rebuilt after the update.`,
        );

        if (!confirmed) {
            return;
        }

        setLoading(true);
        clearFlashes('admin:extensions');
        onPackageActionStart({ extensionId: extension.id, extensionName: extension.name, type: 'update' });

        upgradeExtension(extension.id, extension.source.repositoryId)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} was updated to v${
                        extension.latestVersion ?? 'latest'
                    } and M12Labs was rebuilt.`,
                });
                onRefresh();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => {
                setLoading(false);
                onPackageActionEnd(extension.id);
            });
    };

    const handleSaveConfig = () => {
        setLoading(true);
        clearFlashes('admin:extensions');

        updateExtension(extension.id, selectedNests, selectedEggs, settings)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} configuration has been updated.`,
                });
                setConfigOpen(false);
                onRefresh();
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }))
            .finally(() => setLoading(false));
    };

    const renderSettingField = (field: ExtensionSettingField) => {
        const value = settings[field.key];

        if (field.type === 'boolean') {
            return (
                <label key={field.key} className={'flex items-start gap-3 rounded border p-3'} style={surfaceStyle}>
                    <Input
                        type={'checkbox'}
                        checked={Boolean(value)}
                        onChange={event => updateSetting(field.key, event.currentTarget.checked)}
                    />
                    <div className={'flex-1'}>
                        <p className={'text-sm font-medium text-white'}>{field.label}</p>
                        {field.help && <p className={'mt-1 text-xs text-neutral-400'}>{field.help}</p>}
                    </div>
                </label>
            );
        }

        return (
            <div key={field.key} className={'rounded border p-3'} style={surfaceStyle}>
                <label className={'block text-sm font-medium text-white'}>{field.label}</label>
                {field.help && <p className={'mt-1 text-xs text-neutral-400'}>{field.help}</p>}
                <div className={'mt-2'}>
                    {field.type === 'textarea' ? (
                        <Textarea
                            rows={4}
                            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
                            placeholder={field.placeholder}
                            onChange={event => updateSetting(field.key, event.currentTarget.value)}
                        />
                    ) : field.type === 'select' ? (
                        <Select
                            value={value === undefined || value === null ? '' : String(value)}
                            onChange={event => updateSetting(field.key, event.currentTarget.value)}
                        >
                            <option value={''}>Select...</option>
                            {(field.options ?? []).map(option => (
                                <option key={String(option.value)} value={String(option.value)}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    ) : (
                        <Input
                            type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
                            placeholder={field.placeholder}
                            onChange={event => {
                                if (field.type === 'number') {
                                    const raw = event.currentTarget.value;
                                    updateSetting(field.key, raw === '' ? '' : Number(raw));

                                    return;
                                }

                                updateSetting(field.key, event.currentTarget.value);
                            }}
                        />
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            <div
                className={classNames(
                    'flex h-full flex-col rounded-xl border p-5 shadow-lg transition-transform duration-200',
                    !loading && 'hover:-translate-y-1',
                    isSelected && 'ring-2',
                )}
                style={{ ...cardStyle, ...(isSelected ? { ['--tw-ring-color' as string]: primary } : {}) }}
            >
                <div className={'flex items-start justify-between gap-4'}>
                    <div className={'flex items-center gap-3'}>
                        {onToggleSelect && (
                            <button
                                type={'button'}
                                onClick={onToggleSelect}
                                className={
                                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors'
                                }
                                style={{
                                    borderColor: isSelected ? primary : undefined,
                                    backgroundColor: isSelected ? primary : undefined,
                                }}
                                aria-label={isSelected ? `Deselect ${extension.name}` : `Select ${extension.name}`}
                            >
                                {isSelected && <FontAwesomeIcon icon={faCheck} className={'text-xs text-white'} />}
                            </button>
                        )}
                        <div
                            className={'flex h-12 w-12 items-center justify-center rounded-xl'}
                            style={{ backgroundColor: `${primary}1f` }}
                        >
                            <FontAwesomeIcon icon={icon} className={'text-xl'} style={{ color: primary }} />
                        </div>
                        <div>
                            <h3 className={'text-lg font-semibold text-white'}>{extension.name}</h3>
                            <p className={'text-xs text-neutral-400'}>
                                v{extension.version}
                                {extension.latestVersion && extension.latestVersion !== extension.version
                                    ? ` • latest ${extension.latestVersion}`
                                    : ''}
                                {extension.author ? ` • ${extension.author}` : ''}
                            </p>
                        </div>
                    </div>
                    <span
                        className={
                            'rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-200'
                        }
                        style={statusPillStyle}
                    >
                        {extension.status === 'core' ? 'Core' : extension.installed ? 'Installed' : 'Available'}
                    </span>
                </div>

                <p className={'mt-4 flex-1 text-sm leading-6 text-neutral-300'}>{extension.description}</p>

                <div className={'mt-4 space-y-3'}>
                    <div className={'flex flex-wrap gap-2 text-xs'}>
                        <span className={'rounded-full border px-3 py-1 text-neutral-300'} style={neutralPillStyle}>
                            Source: {extension.source?.label ?? 'Unknown'}
                        </span>
                        {currentPanelVersion && (
                            <span className={'rounded-full border px-3 py-1 text-neutral-300'} style={neutralPillStyle}>
                                Panel: {currentPanelVersion}
                            </span>
                        )}
                        {manageable && (
                            <span className={'rounded-full border px-3 py-1 text-neutral-300'} style={enabledPillStyle}>
                                {extension.enabled ? 'Enabled for servers' : 'Disabled for servers'}
                            </span>
                        )}
                        {extension.updateAvailable && (
                            <span className={'rounded-full border px-3 py-1 text-neutral-200'} style={updatePillStyle}>
                                Update available
                            </span>
                        )}
                    </div>

                    <div className={'rounded-lg border p-3 text-xs'} style={compatibilityBoxStyle}>
                        <div className={'flex items-start gap-2'}>
                            <FontAwesomeIcon
                                icon={installBlockedByPanelVersion ? faTriangleExclamation : faShieldHalved}
                                className={'mt-0.5'}
                                style={{ color: primary }}
                            />
                            <div className={'flex-1'}>
                                <p className={'font-semibold uppercase tracking-wide'} style={{ color: primary }}>
                                    {compatibilityHeading}
                                </p>
                                <p className={'mt-1 leading-5 text-neutral-200'}>{compatibilityMessage}</p>
                                <div className={'mt-3 flex flex-wrap gap-2'}>
                                    {!hasPanelRestrictions ? (
                                        <span
                                            className={'rounded-full border px-3 py-1 font-medium'}
                                            style={accentPillStyle}
                                        >
                                            Any panel version
                                        </span>
                                    ) : (
                                        compatiblePanelVersions.map(version => (
                                            <span
                                                key={version}
                                                className={'rounded-full border px-3 py-1 font-medium text-neutral-100'}
                                                style={
                                                    currentPanelVersion === version ? accentPillStyle : neutralPillStyle
                                                }
                                            >
                                                {version}
                                            </span>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {extension.source?.securityWarning && !extension.source.official && (
                        <div className={'rounded-lg border p-3 text-xs'} style={accentSurfaceStyle}>
                            <div className={'flex items-start gap-2'}>
                                <FontAwesomeIcon
                                    icon={faTriangleExclamation}
                                    className={'mt-0.5'}
                                    style={{ color: primary }}
                                />
                                <span className={'text-neutral-200'}>{extension.source.securityWarning}</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className={'mt-5 grid gap-2 sm:grid-cols-2'}>
                    {extension.installable && extension.source?.repositoryId ? (
                        <Button
                            onClick={handleInstall}
                            loading={loading}
                            disabled={loading || installBlockedByPanelVersion || anotherPackageActionInProgress}
                            icon={() => <FontAwesomeIcon icon={faDownload} />}
                        >
                            {installBlockedByPanelVersion ? 'Unsupported panel' : 'Install'}
                        </Button>
                    ) : (
                        <Button.Dark onClick={handleToggle} loading={loading} disabled={loading || !manageable}>
                            <FontAwesomeIcon icon={extension.enabled ? faToggleOn : faToggleOff} className={'mr-2'} />
                            {extension.enabled ? 'Disable' : 'Enable'}
                        </Button.Dark>
                    )}

                    <Button.Text onClick={() => setConfigOpen(true)} disabled={!manageable || loading}>
                        <FontAwesomeIcon icon={faCog} className={'mr-2'} />
                        Configure
                    </Button.Text>

                    {extension.updateAvailable && extension.canUninstall && extension.source?.repositoryId && (
                        <Button
                            onClick={handleUpdate}
                            loading={loading}
                            disabled={loading || anotherPackageActionInProgress}
                        >
                            <FontAwesomeIcon icon={faArrowsRotate} className={'mr-2'} />
                            Update to v{extension.latestVersion}
                        </Button>
                    )}

                    {extension.canUninstall && (
                        <Button.Danger
                            onClick={handleUninstall}
                            loading={loading}
                            disabled={loading || anotherPackageActionInProgress}
                        >
                            <FontAwesomeIcon icon={faTrash} className={'mr-2'} />
                            Uninstall
                        </Button.Danger>
                    )}
                </div>
            </div>

            <Modal
                visible={configOpen}
                onDismissed={() => setConfigOpen(false)}
                closeOnBackground
                showSpinnerOverlay={loading}
            >
                <div className={'max-h-[80vh] overflow-y-auto'}>
                    <h2 className={'text-xl font-semibold text-white'}>Configure {extension.name}</h2>
                    <p className={'mt-2 text-sm text-neutral-400'}>
                        Limit this extension to specific nests or eggs. Leaving both lists empty makes it available on
                        all eligible servers.
                    </p>

                    {!manageable ? (
                        <div className={'mt-6 rounded-lg border p-4 text-sm text-neutral-300'} style={surfaceStyle}>
                            Install this extension before configuring it.
                        </div>
                    ) : !nestsAndEggs ? (
                        <div className={'flex justify-center py-10'}>
                            <Spinner size={'large'} />
                        </div>
                    ) : (
                        <div className={'mt-6 space-y-6'}>
                            <section>
                                <div className={'mb-3 flex items-center justify-between'}>
                                    <h3 className={'text-sm font-semibold uppercase tracking-wide text-neutral-300'}>
                                        Nests
                                    </h3>
                                    <div className={'flex gap-2 text-xs'}>
                                        <Button.Text
                                            onClick={() => setSelectedNests(nestsAndEggs.nests.map(nest => nest.id))}
                                        >
                                            Select all
                                        </Button.Text>
                                        <Button.Text onClick={() => setSelectedNests([])}>Clear</Button.Text>
                                    </div>
                                </div>
                                <div className={'grid gap-2 sm:grid-cols-2'}>
                                    {nestsAndEggs.nests.map(nest => (
                                        <label
                                            key={nest.id}
                                            className={'flex items-start gap-3 rounded border p-3'}
                                            style={surfaceStyle}
                                        >
                                            <Input
                                                type={'checkbox'}
                                                checked={selectedNests.includes(nest.id)}
                                                onChange={() =>
                                                    setSelectedNests(current =>
                                                        current.includes(nest.id)
                                                            ? current.filter(id => id !== nest.id)
                                                            : [...current, nest.id],
                                                    )
                                                }
                                            />
                                            <div>
                                                <p className={'text-sm font-medium text-white'}>{nest.name}</p>
                                                {nest.description && (
                                                    <p className={'mt-1 text-xs text-neutral-400'}>
                                                        {nest.description}
                                                    </p>
                                                )}
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <div className={'mb-3 flex items-center justify-between'}>
                                    <h3 className={'text-sm font-semibold uppercase tracking-wide text-neutral-300'}>
                                        Eggs
                                    </h3>
                                    <div className={'flex gap-2 text-xs'}>
                                        <Button.Text onClick={() => setSelectedEggs(filteredEggs.map(egg => egg.id))}>
                                            Select filtered
                                        </Button.Text>
                                        <Button.Text onClick={() => setSelectedEggs([])}>Clear</Button.Text>
                                    </div>
                                </div>
                                <div className={'grid gap-2 sm:grid-cols-2'}>
                                    {filteredEggs.map(egg => (
                                        <label
                                            key={egg.id}
                                            className={'flex items-start gap-3 rounded border p-3'}
                                            style={surfaceStyle}
                                        >
                                            <Input
                                                type={'checkbox'}
                                                checked={selectedEggs.includes(egg.id)}
                                                onChange={() =>
                                                    setSelectedEggs(current =>
                                                        current.includes(egg.id)
                                                            ? current.filter(id => id !== egg.id)
                                                            : [...current, egg.id],
                                                    )
                                                }
                                            />
                                            <div>
                                                <p className={'text-sm font-medium text-white'}>{egg.name}</p>
                                                <p className={'mt-1 text-xs text-neutral-500'}>{egg.nestName}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </section>

                            {extension.settingsSchema && extension.settingsSchema.length > 0 && (
                                <section>
                                    <h3
                                        className={
                                            'mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300'
                                        }
                                    >
                                        Settings
                                    </h3>
                                    <div className={'space-y-3'}>
                                        {extension.settingsSchema.map(field => renderSettingField(field))}
                                    </div>
                                </section>
                            )}

                            <div className={'flex justify-end gap-3 pt-2'}>
                                <Button.Text onClick={() => setConfigOpen(false)} disabled={loading}>
                                    Cancel
                                </Button.Text>
                                <Button onClick={handleSaveConfig} loading={loading} disabled={loading}>
                                    Save configuration
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </>
    );
};
