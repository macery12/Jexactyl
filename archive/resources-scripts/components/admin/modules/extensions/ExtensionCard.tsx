import { useState, useEffect } from 'react';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faPuzzlePiece,
    faUsers,
    faGamepad,
    faCube,
    faServer,
    faToggleOn,
    faToggleOff,
    faCog,
    faCheck,
    faLink,
    faWrench,
    faShieldHalved,
    faTerminal,
    faGlobe,
    faDatabase,
    faChartLine,
    faBell,
    faRobot,
    faCloud,
    faFolder,
    faFile,
    faKey,
    faBolt,
    faCogs,
    faLock,
    faScroll,
} from '@fortawesome/free-solid-svg-icons';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { Button } from '@/elements/button';
import Modal from '@/elements/Modal';
import {
    ExtensionData,
    ExtensionSettingField,
    NestOption,
    EggOption,
    getNestsAndEggs,
    toggleExtension,
    updateExtension,
} from '@/api/routes/admin/extensions';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import Input, { Textarea } from '@/elements/Input';
import Select from '@/elements/Select';

interface Props {
    extension: ExtensionData;
    onUpdate: () => void;
}

const iconMap: Record<string, typeof faPuzzlePiece> = {
    puzzle: faPuzzlePiece,
    users: faUsers,
    gamepad: faGamepad,
    cube: faCube,
    server: faServer,

    // Extra icons for extension authors.
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

export default ({ extension, onUpdate }: Props) => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();

    const [configOpen, setConfigOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [nestsAndEggs, setNestsAndEggs] = useState<{ nests: NestOption[]; eggs: EggOption[] } | null>(null);
    const [selectedNests, setSelectedNests] = useState<number[]>(extension.allowedNests);
    const [selectedEggs, setSelectedEggs] = useState<number[]>(extension.allowedEggs);
    const [settings, setSettings] = useState<Record<string, unknown>>(extension.settings ?? {});

    const icon = iconMap[extension.icon] || faPuzzlePiece;

    useEffect(() => {
        if (configOpen && !nestsAndEggs) {
            getNestsAndEggs()
                .then(data => setNestsAndEggs(data))
                .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }));
        }
    }, [configOpen]);

    useEffect(() => {
        if (configOpen) {
            setSelectedNests(extension.allowedNests);
            setSelectedEggs(extension.allowedEggs);
            setSettings(extension.settings ?? {});
        }
    }, [configOpen, extension.allowedNests, extension.allowedEggs, extension.settings]);

    const handleToggle = () => {
        setLoading(true);
        clearFlashes('admin:extensions');

        toggleExtension(extension.id)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${extension.name} has been ${extension.enabled ? 'disabled' : 'enabled'}.`,
                });
                onUpdate();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => setLoading(false));
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
                onUpdate();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => setLoading(false));
    };

    const toggleNest = (nestId: number) => {
        setSelectedNests((prev: number[]) =>
            prev.includes(nestId) ? prev.filter((id: number) => id !== nestId) : [...prev, nestId],
        );
    };

    const toggleEgg = (eggId: number) => {
        setSelectedEggs((prev: number[]) =>
            prev.includes(eggId) ? prev.filter((id: number) => id !== eggId) : [...prev, eggId],
        );
    };

    const selectAllNests = () => {
        if (nestsAndEggs) {
            setSelectedNests(nestsAndEggs.nests.map((n: NestOption) => n.id));
        }
    };

    const clearNests = () => {
        setSelectedNests([]);
    };

    // Get filtered eggs based on selected nests
    const filteredEggs =
        nestsAndEggs?.eggs.filter(
            (egg: EggOption) => selectedNests.length === 0 || selectedNests.includes(egg.nestId),
        ) ?? [];

    const selectAllEggs = () => {
        if (filteredEggs.length > 0) {
            setSelectedEggs(filteredEggs.map((e: EggOption) => e.id));
        }
    };

    const clearEggs = () => {
        setSelectedEggs([]);
    };

    const updateSetting = (key: string, value: unknown) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const renderSettingField = (field: ExtensionSettingField) => {
        const value = settings[field.key];

        if (field.type === 'boolean') {
            return (
                <label key={field.key} className={'flex items-start space-x-3 rounded bg-zinc-800/50 p-3'}>
                    <Input
                        type={'checkbox'}
                        checked={Boolean(value)}
                        onChange={e => updateSetting(field.key, e.currentTarget.checked)}
                    />
                    <div className={'flex-1'}>
                        <p className={'text-sm font-medium text-white'}>{field.label}</p>
                        {field.help && <p className={'mt-1 text-xs text-neutral-400'}>{field.help}</p>}
                    </div>
                </label>
            );
        }

        const commonProps = {
            name: field.key,
            placeholder: field.placeholder,
        };

        return (
            <div key={field.key} className={'rounded bg-zinc-800/50 p-3'}>
                <label className={'block text-sm font-medium text-white'}>{field.label}</label>
                {field.help && <p className={'mt-1 text-xs text-neutral-400'}>{field.help}</p>}
                <div className={'mt-2'}>
                    {field.type === 'textarea' ? (
                        <Textarea
                            {...commonProps}
                            rows={4}
                            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
                            onChange={e => updateSetting(field.key, e.currentTarget.value)}
                        />
                    ) : field.type === 'select' ? (
                        <Select
                            value={value === undefined || value === null ? '' : String(value)}
                            onChange={e => updateSetting(field.key, e.currentTarget.value)}
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
                            {...commonProps}
                            type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
                            onChange={e => {
                                if (field.type === 'number') {
                                    const raw = e.currentTarget.value;
                                    updateSetting(field.key, raw === '' ? '' : Number(raw));
                                    return;
                                }

                                updateSetting(field.key, e.currentTarget.value);
                            }}
                        />
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Sticky Note Style Card */}
            <div
                className={classNames(
                    'relative transform transition-all duration-200 hover:-translate-y-1 hover:shadow-xl',
                    'flex h-full flex-col rounded-lg p-6 shadow-lg bg-zinc-800',
                )}
                style={{
                    borderTop: `4px solid ${extension.enabled ? primary : '#4a5568'}`,
                    minHeight: 'var(--extension-card-min-height, auto)',
                }}
                data-extension-card
            >
                {/* Pin decoration */}
                <div
                    className={'absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 transform rounded-full shadow-md'}
                    style={{ backgroundColor: extension.enabled ? primary : '#4a5568' }}
                />

                {/* Header */}
                <div className={'mb-4 flex items-start justify-between'}>
                    <div className={'flex items-center space-x-3'}>
                        <div
                            className={'flex h-12 w-12 items-center justify-center rounded-lg'}
                            style={{ backgroundColor: `${primary}20` }}
                        >
                            <FontAwesomeIcon icon={icon} className={'text-xl'} style={{ color: primary }} />
                        </div>
                        <div>
                            <h3 className={'text-lg font-semibold text-white'}>{extension.name}</h3>
                            <p className={'text-xs text-neutral-400'}>
                                v{extension.version} • {extension.author}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleToggle}
                        disabled={loading}
                        className={'transition-colors focus:outline-none'}
                    >
                        <FontAwesomeIcon
                            icon={extension.enabled ? faToggleOn : faToggleOff}
                            className={'text-2xl'}
                            style={{ color: extension.enabled ? primary : '#6b7280' }}
                        />
                    </button>
                </div>

                <div className={'flex-1'}>
                    {/* Description */}
                    <p className={'mb-4 text-sm text-neutral-300'}>{extension.description}</p>
                </div>

                {/* Stats */}
                <div className={'mb-4 grid grid-cols-2 gap-2 text-xs'}>
                    <div className={'rounded bg-zinc-800/50 p-2'}>
                        <span className={'text-neutral-400'}>Nests: </span>
                        <span className={'font-medium text-white'}>
                            {extension.allowedNests.length === 0 ? 'All' : extension.allowedNests.length}
                        </span>
                    </div>
                    <div className={'rounded bg-zinc-800/50 p-2'}>
                        <span className={'text-neutral-400'}>Eggs: </span>
                        <span className={'font-medium text-white'}>
                            {extension.allowedEggs.length === 0 ? 'All' : extension.allowedEggs.length}
                        </span>
                    </div>
                </div>

                {/* Configure Button */}
                <Button onClick={() => setConfigOpen(true)} className={'w-full'}>
                    <FontAwesomeIcon icon={faCog} className={'mr-2'} />
                    Configure
                </Button>
            </div>

            {/* Configuration Modal */}
            <Modal
                visible={configOpen}
                onDismissed={() => setConfigOpen(false)}
                closeOnBackground
                showSpinnerOverlay={loading}
            >
                <div className={'max-h-[80vh] overflow-y-auto'}>
                    <h2 className={'mb-4 text-xl font-semibold text-white'}>Configure {extension.name}</h2>
                    <p className={'mb-6 text-sm text-neutral-400'}>
                        Select which nests and eggs can use this extension. Leaving selections empty means all
                        nests/eggs are allowed.
                    </p>

                    {!nestsAndEggs ? (
                        <div className={'flex justify-center py-8'}>
                            <Spinner size={'large'} />
                        </div>
                    ) : (
                        <>
                            {!!extension.settingsSchema?.length && (
                                <div className={'mb-6'}>
                                    <h3 className={'mb-2 font-medium text-white'}>Settings</h3>
                                    <div className={'space-y-3'}>
                                        {extension.settingsSchema.map(renderSettingField)}
                                    </div>
                                </div>
                            )}

                            {/* Nests Selection */}
                            <div className={'mb-6'}>
                                <div className={'mb-2 flex items-center justify-between'}>
                                    <h3 className={'font-medium text-white'}>Allowed Nests</h3>
                                    <div className={'space-x-2'}>
                                        <button
                                            onClick={selectAllNests}
                                            className={'text-xs text-neutral-400 hover:text-white'}
                                        >
                                            Select All
                                        </button>
                                        <span className={'text-neutral-600'}>|</span>
                                        <button
                                            onClick={clearNests}
                                            className={'text-xs text-neutral-400 hover:text-white'}
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                                <div className={'grid gap-2 sm:grid-cols-2'}>
                                    {nestsAndEggs.nests.map((nest: NestOption) => (
                                        <label
                                            key={nest.id}
                                            className={classNames(
                                                'flex cursor-pointer items-center rounded-lg border p-3 transition-colors h-full min-h-[60px]',
                                                selectedNests.includes(nest.id)
                                                    ? 'border-opacity-50 bg-opacity-10'
                                                    : 'border-neutral-600 bg-zinc-800',
                                            )}
                                            style={{
                                                borderColor: selectedNests.includes(nest.id) ? primary : undefined,
                                                backgroundColor: selectedNests.includes(nest.id)
                                                    ? `${primary}15`
                                                    : undefined,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedNests.includes(nest.id)}
                                                onChange={() => toggleNest(nest.id)}
                                                className={'sr-only'}
                                            />
                                            <div
                                                className={classNames(
                                                    'mr-3 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2',
                                                    selectedNests.includes(nest.id)
                                                        ? 'border-transparent'
                                                        : 'border-neutral-500',
                                                )}
                                                style={{
                                                    backgroundColor: selectedNests.includes(nest.id)
                                                        ? primary
                                                        : 'transparent',
                                                }}
                                            >
                                                {selectedNests.includes(nest.id) && (
                                                    <FontAwesomeIcon icon={faCheck} className={'text-xs text-white'} />
                                                )}
                                            </div>
                                            <div className={'min-w-0 flex-1'}>
                                                <p className={'text-sm font-medium text-white'}>{nest.name}</p>
                                                {nest.description && (
                                                    <p className={'text-xs text-neutral-400 line-clamp-1'}>
                                                        {nest.description}
                                                    </p>
                                                )}
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Eggs Selection */}
                            <div className={'mb-6'}>
                                <div className={'mb-2 flex items-center justify-between'}>
                                    <h3 className={'font-medium text-white'}>
                                        Allowed Eggs
                                        {selectedNests.length > 0 && (
                                            <span className={'ml-2 text-xs font-normal text-neutral-400'}>
                                                (showing {filteredEggs.length} eggs from selected nests)
                                            </span>
                                        )}
                                    </h3>
                                    <div className={'space-x-2'}>
                                        <button
                                            onClick={selectAllEggs}
                                            className={'text-xs text-neutral-400 hover:text-white'}
                                        >
                                            Select All
                                        </button>
                                        <span className={'text-neutral-600'}>|</span>
                                        <button
                                            onClick={clearEggs}
                                            className={'text-xs text-neutral-400 hover:text-white'}
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                                {filteredEggs.length === 0 ? (
                                    <p className={'text-sm text-neutral-500 py-4 text-center'}>
                                        {selectedNests.length === 0
                                            ? 'No eggs available.'
                                            : 'No eggs found in the selected nests.'}
                                    </p>
                                ) : (
                                    <div className={'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
                                        {filteredEggs.map((egg: EggOption) => (
                                            <label
                                                key={egg.id}
                                                className={classNames(
                                                    'flex cursor-pointer items-center rounded-lg border p-3 transition-colors',
                                                    selectedEggs.includes(egg.id)
                                                        ? 'border-opacity-50 bg-opacity-10'
                                                        : 'border-neutral-600 bg-zinc-800',
                                                )}
                                                style={{
                                                    borderColor: selectedEggs.includes(egg.id) ? primary : undefined,
                                                    backgroundColor: selectedEggs.includes(egg.id)
                                                        ? `${primary}15`
                                                        : undefined,
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedEggs.includes(egg.id)}
                                                    onChange={() => toggleEgg(egg.id)}
                                                    className={'sr-only'}
                                                />
                                                <div
                                                    className={classNames(
                                                        'mr-3 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2',
                                                        selectedEggs.includes(egg.id)
                                                            ? 'border-transparent'
                                                            : 'border-neutral-500',
                                                    )}
                                                    style={{
                                                        backgroundColor: selectedEggs.includes(egg.id)
                                                            ? primary
                                                            : 'transparent',
                                                    }}
                                                >
                                                    {selectedEggs.includes(egg.id) && (
                                                        <FontAwesomeIcon
                                                            icon={faCheck}
                                                            className={'text-xs text-white'}
                                                        />
                                                    )}
                                                </div>
                                                <div className={'min-w-0'}>
                                                    <p className={'truncate text-sm font-medium text-white'}>
                                                        {egg.name}
                                                    </p>
                                                    <p className={'text-xs text-neutral-500'}>{egg.nestName}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* Actions */}
                    <div className={'flex justify-end space-x-3'}>
                        <Button.Text onClick={() => setConfigOpen(false)}>Cancel</Button.Text>
                        <Button onClick={handleSaveConfig} disabled={loading || !nestsAndEggs}>
                            Save Configuration
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
};
