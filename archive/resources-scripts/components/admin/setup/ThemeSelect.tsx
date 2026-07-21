import { useEffect, useState } from 'react';
import updateColors from '@/api/routes/admin/theme/updateColors';
import applyPreset from '@/api/routes/admin/theme/applyPreset';
import getPresets, { ThemePreset } from '@/api/routes/admin/theme/getPresets';
import useStatus from '@/plugins/useStatus';
import { useStoreActions, useStoreState } from '@/state/hooks';
import AdminBox from '@/elements/AdminBox';
import { faCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { CheckCircleIcon } from '@heroicons/react/outline';

const colorOptions = [
    { hex: '#0047fc', name: 'M12Labs Blue' },
    { hex: '#16a34a', name: 'Jexactyl Green' },
    { hex: '#12aaaa', name: 'Microsoft Teal' },
    { hex: '#ff0000', name: 'Brick Red' },
    { hex: '#9D00FF', name: 'Iris Purple' },
    { hex: '#FFA500', name: 'Orange Orange' },
    { hex: '#32559f', name: 'Ptero Blue' },
    { hex: '#ff99c8', name: 'Pretty Pink' },
    { hex: '#5e6472', name: 'Plain Grey' },
];

export default ({ defaultColor }: { defaultColor: string }) => {
    const { status, setStatus } = useStatus();
    const theme = useStoreState(state => state.theme.data!);
    const setTheme = useStoreActions(actions => actions.theme.setTheme);
    const [presets, setPresets] = useState<ThemePreset[]>([]);
    const [applyingId, setApplyingId] = useState<number | null>(null);
    const [appliedId, setAppliedId] = useState<number | null>(null);

    useEffect(() => {
        getPresets()
            .then(setPresets)
            .catch(() => undefined);
    }, []);

    const changeColor = (hex: string) => {
        setStatus('loading');

        updateColors('primary', hex).then(() => {
            setStatus('success');
            setTheme({
                ...theme,
                colors: {
                    ...theme.colors,
                    primary: hex,
                },
            });
        });
    };

    const handleApplyPreset = (preset: ThemePreset) => {
        setApplyingId(preset.id);
        applyPreset(preset.id)
            .then(colors => {
                setTheme({ ...theme, colors });
                setAppliedId(preset.id);
                setTimeout(() => setAppliedId(null), 2000);
            })
            .finally(() => setApplyingId(null));
    };

    return (
        <div>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Theme Preferences</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Select a preferred primary color for your Panel UI.
                    </p>
                </div>
            </div>
            <AdminBox status={status} title={'Set Primary Color'}>
                <div
                    className={'grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4 lg:grid-cols-6 xl:grid-cols-8 lg:gap-6'}
                >
                    {colorOptions.map(option => (
                        <div
                            className={'relative text-center'}
                            key={option.hex}
                            onClick={() => changeColor(option.hex)}
                        >
                            <FontAwesomeIcon
                                icon={faCircle}
                                style={{ color: option.hex }}
                                size={'3x'}
                                className={'transition duration-300 hover:brightness-125'}
                            />
                            {defaultColor === option.hex && (
                                <div className={'absolute top-[10px] right-[27px]'}>
                                    <CheckCircleIcon className={'w-7'} />
                                </div>
                            )}
                            <p className={'mt-1 text-xs italic text-gray-400'}>{option.name}</p>
                        </div>
                    ))}
                </div>
            </AdminBox>
            <p className={'mt-2 text-right text-gray-400'}>Select a color from the options to apply it.</p>

            {presets.length > 0 && (
                <div className={'mt-6'}>
                    <AdminBox title={'Apply a Full Preset'}>
                        <p className={'mb-4 text-sm text-gray-400'}>
                            Presets apply all five colors at once — primary, secondary, background, headers and sidebar.
                        </p>
                        <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'}>
                            {presets.map(preset => (
                                <button
                                    key={preset.id}
                                    type={'button'}
                                    onClick={() => handleApplyPreset(preset)}
                                    disabled={applyingId === preset.id}
                                    className={
                                        'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ' +
                                        (appliedId === preset.id
                                            ? 'border-green-500 bg-green-900/20'
                                            : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-500')
                                    }
                                >
                                    <div className={'flex items-center justify-between'}>
                                        <span className={'truncate text-sm font-semibold text-neutral-100'}>
                                            {preset.name}
                                        </span>
                                        {appliedId === preset.id && (
                                            <CheckCircleIcon className={'ml-2 h-4 w-4 shrink-0 text-green-400'} />
                                        )}
                                    </div>
                                    <div className={'flex items-center gap-1.5'}>
                                        {(['primary', 'secondary', 'background', 'headers', 'sidebar'] as const).map(
                                            k => (
                                                <span
                                                    key={k}
                                                    className={
                                                        'inline-block h-4 w-4 rounded-full border border-black/30'
                                                    }
                                                    style={{ background: preset.colors[k] }}
                                                    title={k}
                                                />
                                            ),
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </AdminBox>
                </div>
            )}
        </div>
    );
};
