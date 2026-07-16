import { useEffect, useRef, useState } from 'react';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import Spinner from '@/elements/Spinner';
import { Dialog } from '@/elements/dialog';
import { useStoreActions, useStoreState } from '@/state/hooks';
import getPresets, { ThemePreset } from '@/api/routes/admin/theme/getPresets';
import savePreset from '@/api/routes/admin/theme/savePreset';
import applyPreset from '@/api/routes/admin/theme/applyPreset';
import deletePreset from '@/api/routes/admin/theme/deletePreset';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLayerGroup, faTrash, faCheck, faFloppyDisk } from '@fortawesome/free-solid-svg-icons';

interface Props {
    /** Called after a preset is applied so the parent can trigger a preview reload */
    onApplied?: () => void;
}

const ColorSwatch = ({ hex, title }: { hex: string; title: string }) => (
    <span
        className={'inline-block h-4 w-4 rounded-full border border-black/30'}
        style={{ background: hex }}
        title={title}
    />
);

export default ({ onApplied }: Props) => {
    const [presets, setPresets] = useState<ThemePreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState<number | null>(null);
    const [deleting, setDeleting] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [savedId, setSavedId] = useState<number | null>(null);
    const [appliedId, setAppliedId] = useState<number | null>(null);

    const theme = useStoreState(state => state.theme.data!);
    const setTheme = useStoreActions(actions => actions.theme.setTheme);

    const fetchPresets = () => {
        setLoading(true);
        getPresets()
            .then(setPresets)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchPresets();
    }, []);

    const handleApply = (preset: ThemePreset) => {
        setApplying(preset.id);
        applyPreset(preset.id)
            .then(colors => {
                setTheme({ ...theme, colors });
                setAppliedId(preset.id);
                onApplied?.();
                setTimeout(() => setAppliedId(null), 2000);
            })
            .finally(() => setApplying(null));
    };

    const handleDelete = (id: number) => {
        deletePreset(id).then(() => {
            setPresets(prev => prev.filter(p => p.id !== id));
            setDeleting(null);
        });
    };

    const handleSave = () => {
        if (!presetName.trim()) return;
        setSaving(true);
        savePreset(presetName.trim())
            .then(preset => {
                setPresets(prev => [...prev, preset]);
                setPresetName('');
                setSavedId(preset.id);
                setTimeout(() => setSavedId(null), 2000);
            })
            .finally(() => setSaving(false));
    };

    return (
        <AdminBox title={'Theme Presets'} icon={faLayerGroup}>
            {/* Delete confirmation */}
            {deleting !== null && (
                <Dialog.Confirm
                    title={'Delete Preset'}
                    open
                    onClose={() => setDeleting(null)}
                    onConfirmed={() => handleDelete(deleting)}
                >
                    Are you sure you want to delete this preset? This cannot be undone.
                </Dialog.Confirm>
            )}

            {loading ? (
                <div className={'flex justify-center py-4'}>
                    <Spinner size={'base'} />
                </div>
            ) : (
                <div className={'flex flex-col gap-4'}>
                    {/* Preset cards */}
                    <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'}>
                        {presets.map(preset => (
                            <div
                                key={preset.id}
                                className={
                                    'relative flex flex-col gap-2 rounded-lg border p-3 transition-colors ' +
                                    (appliedId === preset.id
                                        ? 'border-green-500 bg-green-900/20'
                                        : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-500')
                                }
                            >
                                <div className={'flex items-center justify-between gap-2'}>
                                    <span className={'truncate text-sm font-semibold text-neutral-100'}>
                                        {preset.name}
                                    </span>
                                    {preset.is_builtin && (
                                        <span
                                            className={
                                                'shrink-0 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400'
                                            }
                                        >
                                            built-in
                                        </span>
                                    )}
                                </div>

                                {/* Color swatches */}
                                <div className={'flex items-center gap-1.5'}>
                                    <ColorSwatch hex={preset.colors.primary} title={'Primary'} />
                                    <ColorSwatch hex={preset.colors.secondary} title={'Secondary'} />
                                    <ColorSwatch hex={preset.colors.background} title={'Background'} />
                                    <ColorSwatch hex={preset.colors.headers} title={'Headers'} />
                                    <ColorSwatch hex={preset.colors.sidebar} title={'Sidebar'} />
                                </div>

                                <div className={'mt-auto flex items-center gap-2'}>
                                    <Button
                                        size={Button.Sizes.Small}
                                        onClick={() => handleApply(preset)}
                                        disabled={applying === preset.id}
                                        className={'flex-1 whitespace-nowrap'}
                                        style={{ backgroundColor: preset.colors.primary }}
                                    >
                                        {applying === preset.id ? (
                                            <Spinner size={'small'} />
                                        ) : appliedId === preset.id ? (
                                            <>
                                                <FontAwesomeIcon icon={faCheck} className={'mr-1'} />
                                                Applied
                                            </>
                                        ) : (
                                            'Apply'
                                        )}
                                    </Button>

                                    {!preset.is_builtin && (
                                        <Button.Danger
                                            size={Button.Sizes.Small}
                                            onClick={() => setDeleting(preset.id)}
                                            className={'px-2'}
                                        >
                                            <FontAwesomeIcon icon={faTrash} />
                                        </Button.Danger>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Save current as preset */}
                    <div className={'mt-2 border-t border-dashed border-neutral-700 pt-4'}>
                        <p className={'mb-2 text-sm font-medium text-neutral-300'}>Save Current Theme as Preset</p>
                        <div className={'flex gap-2'}>
                            <Input
                                placeholder={'Preset name…'}
                                value={presetName}
                                onChange={e => setPresetName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSave()}
                                className={'flex-1'}
                            />
                            <Button
                                size={Button.Sizes.Small}
                                onClick={handleSave}
                                disabled={saving || !presetName.trim()}
                                className={'whitespace-nowrap'}
                            >
                                {saving ? (
                                    <Spinner size={'small'} />
                                ) : savedId !== null ? (
                                    <>
                                        <FontAwesomeIcon icon={faCheck} className={'mr-1'} />
                                        Saved
                                    </>
                                ) : (
                                    <>
                                        <FontAwesomeIcon icon={faFloppyDisk} className={'mr-1'} />
                                        Save Preset
                                    </>
                                )}
                            </Button>
                        </div>
                        <p className={'mt-1 text-xs text-neutral-500'}>
                            Saves all five current colors as a reusable preset.
                        </p>
                    </div>
                </div>
            )}
        </AdminBox>
    );
};
