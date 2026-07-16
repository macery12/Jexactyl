import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import AdminCheckbox from '@/elements/AdminCheckbox';
import { searchEggs } from '@/api/routes/admin/egg';
import {
    BillingImportConflict,
    BillingImportConflictResponse,
    BillingImportResolution,
} from '@/api/routes/admin/billing/config';

interface ConflictState {
    nestId: number | null;
    eggId: number | null;
    allowedEggs: number[];
    dropCategory: boolean;
    saved: boolean;
}

interface EggOption {
    id: number;
    name: string;
}

interface Props {
    open: boolean;
    loading: boolean;
    payload: BillingImportConflictResponse | null;
    onClose: () => void;
    onSubmit: (resolution: BillingImportResolution) => void;
}

const buildInitialState = (conflict: BillingImportConflict): ConflictState => ({
    nestId: conflict.current.nest_id,
    eggId: conflict.current.egg_id,
    allowedEggs: conflict.current.allowed_eggs ?? [],
    dropCategory: false,
    saved: false,
});

export default ({ open, loading, payload, onClose, onSubmit }: Props) => {
    const conflicts = payload?.attributes.conflicts ?? [];
    const nests = payload?.attributes.available_nests ?? [];

    const [activeConflictKey, setActiveConflictKey] = useState<string>('');
    const [stateByCategory, setStateByCategory] = useState<Record<string, ConflictState>>({});
    const [eggsByNest, setEggsByNest] = useState<Record<number, EggOption[]>>({});
    const [loadingNestId, setLoadingNestId] = useState<number | null>(null);

    const activeConflict = useMemo(
        () => conflicts.find(c => c.category_key === activeConflictKey) ?? conflicts[0],
        [conflicts, activeConflictKey],
    );

    useEffect(() => {
        if (!open || !payload) return;

        const nextState: Record<string, ConflictState> = {};
        for (const conflict of payload.attributes.conflicts) {
            nextState[conflict.category_key] = buildInitialState(conflict);
        }
        setStateByCategory(nextState);
        setActiveConflictKey(payload.attributes.conflicts[0]?.category_key ?? '');
        setEggsByNest({});
    }, [open, payload]);

    useEffect(() => {
        if (!activeConflict) return;

        const selectedNest = stateByCategory[activeConflict.category_key]?.nestId;
        if (!selectedNest || eggsByNest[selectedNest]) return;

        setLoadingNestId(selectedNest);
        searchEggs(selectedNest, {})
            .then(eggs => {
                setEggsByNest(current => ({
                    ...current,
                    [selectedNest]: eggs.map(egg => ({ id: egg.id, name: egg.name })),
                }));
            })
            .finally(() => setLoadingNestId(null));
    }, [activeConflict, stateByCategory, eggsByNest]);

    const updateConflictState = (categoryKey: string, updater: (state: ConflictState) => ConflictState) => {
        setStateByCategory(current => {
            const fallback = conflicts.find(c => c.category_key === categoryKey);
            if (!fallback && !current[categoryKey]) return current;

            const existing = current[categoryKey] ?? buildInitialState(fallback as BillingImportConflict);
            return { ...current, [categoryKey]: updater(existing) };
        });
    };

    const toggleAllowedEgg = (categoryKey: string, eggId: number, checked: boolean) => {
        updateConflictState(categoryKey, state => {
            const nextAllowed = checked
                ? Array.from(new Set([...state.allowedEggs, eggId]))
                : state.allowedEggs.filter(id => id !== eggId);
            const nextPrimary = nextAllowed.includes(state.eggId ?? -1) ? state.eggId : (nextAllowed[0] ?? null);
            return { ...state, eggId: nextPrimary, allowedEggs: nextAllowed, saved: false };
        });
    };

    const applyConflict = (categoryKey: string) =>
        updateConflictState(categoryKey, state => ({ ...state, saved: true }));

    const dropConflict = (categoryKey: string) =>
        updateConflictState(categoryKey, state => ({ ...state, dropCategory: true, saved: true }));

    const undropConflict = (categoryKey: string) =>
        updateConflictState(categoryKey, state => ({ ...state, dropCategory: false, saved: false }));

    const isConflictDone = (conflict: BillingImportConflict): boolean => {
        const state = stateByCategory[conflict.category_key];
        if (!state) return false;
        if (state.dropCategory) return true;
        return (
            state.saved &&
            !!state.nestId &&
            !!state.eggId &&
            state.allowedEggs.length > 0 &&
            state.allowedEggs.includes(state.eggId)
        );
    };

    const allDone = conflicts.length > 0 && conflicts.every(isConflictDone);
    const doneCount = conflicts.filter(isConflictDone).length;

    const submitImport = () => {
        const categories: BillingImportResolution['categories'] = {};
        for (const conflict of conflicts) {
            const state = stateByCategory[conflict.category_key];
            if (!state) continue;
            categories[conflict.category_key] = {
                nest_id: state.dropCategory ? undefined : (state.nestId ?? undefined),
                egg_id: state.dropCategory ? undefined : (state.eggId ?? undefined),
                allowed_eggs: state.dropCategory ? undefined : state.allowedEggs,
                drop_category: state.dropCategory,
            };
        }
        onSubmit({ categories });
    };

    const activeState = activeConflict ? stateByCategory[activeConflict.category_key] : null;
    const activeNestEggs = activeState?.nestId ? (eggsByNest[activeState.nestId] ?? []) : [];

    const canApplyActive =
        !!activeConflict &&
        !!activeState &&
        !activeState.dropCategory &&
        !!activeState.nestId &&
        !!activeState.eggId &&
        activeState.allowedEggs.length > 0 &&
        activeState.allowedEggs.includes(activeState.eggId);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={'Resolve Import Conflicts'}
            description={`${doneCount} of ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} resolved`}
            size={'xl'}
        >
            {!payload || conflicts.length === 0 ? (
                <p className={'text-sm text-neutral-300'}>No conflicts to resolve.</p>
            ) : (
                <>
                    {/* Two-column layout */}
                    <div className={'flex min-h-[440px] gap-3 overflow-hidden rounded border border-neutral-700'}>
                        {/* ── Left panel: conflict list ── */}
                        <div className={'flex w-64 shrink-0 flex-col border-r border-neutral-700 bg-zinc-800'}>
                            <div className={'border-b border-neutral-700 px-4 py-2.5'}>
                                <p className={'text-xs font-semibold uppercase tracking-wider text-neutral-400'}>
                                    Conflicts
                                </p>
                            </div>

                            <div className={'flex-1 divide-y divide-neutral-700/60 overflow-y-auto'}>
                                {conflicts.map(conflict => {
                                    const done = isConflictDone(conflict);
                                    const dropped = stateByCategory[conflict.category_key]?.dropCategory ?? false;
                                    const isActive = conflict.category_key === activeConflict?.category_key;

                                    return (
                                        <div
                                            key={conflict.category_key}
                                            className={`border-l-2 transition-colors ${
                                                isActive
                                                    ? 'border-l-blue-500 bg-blue-600/10'
                                                    : 'border-l-transparent hover:bg-zinc-700/50'
                                            }`}
                                        >
                                            <button
                                                type={'button'}
                                                onClick={() => setActiveConflictKey(conflict.category_key)}
                                                className={'w-full px-4 py-3 text-left'}
                                            >
                                                <p
                                                    className={`truncate text-sm font-medium ${isActive ? 'text-slate-50' : 'text-neutral-200'}`}
                                                >
                                                    {conflict.category_name}
                                                </p>
                                                <span
                                                    className={`mt-1.5 inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                                                        dropped
                                                            ? 'bg-red-500/20 text-red-300'
                                                            : done
                                                              ? 'bg-green-500/20 text-green-300'
                                                              : 'bg-amber-500/20 text-amber-200'
                                                    }`}
                                                >
                                                    {dropped ? 'Dropped' : done ? 'Resolved' : 'Needs action'}
                                                </span>
                                            </button>

                                            <div className={'px-4 pb-2.5'}>
                                                {dropped ? (
                                                    <button
                                                        type={'button'}
                                                        onClick={() => undropConflict(conflict.category_key)}
                                                        className={
                                                            'text-xs text-neutral-400 transition-colors hover:text-neutral-200'
                                                        }
                                                    >
                                                        Undo drop
                                                    </button>
                                                ) : (
                                                    <button
                                                        type={'button'}
                                                        onClick={() => dropConflict(conflict.category_key)}
                                                        className={
                                                            'text-xs font-bold uppercase tracking-wide text-red-400 transition-colors hover:text-red-200'
                                                        }
                                                    >
                                                        Drop
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Right panel: editor ── */}
                        <div className={'flex min-w-0 flex-1 flex-col bg-zinc-800/40'}>
                            {!activeConflict || !activeState ? (
                                <div className={'flex flex-1 items-center justify-center p-8'}>
                                    <p className={'text-sm text-neutral-500'}>Select a conflict from the list.</p>
                                </div>
                            ) : activeState.dropCategory ? (
                                <div className={'p-5'}>
                                    <div className={'rounded border border-red-700/40 bg-red-950/20 p-4'}>
                                        <p className={'text-sm font-semibold text-red-300'}>
                                            {activeConflict.category_name}
                                        </p>
                                        <p className={'mt-1 text-sm text-red-400/70'}>
                                            This category and all its products will be skipped during import.
                                        </p>
                                        <button
                                            type={'button'}
                                            onClick={() => undropConflict(activeConflict.category_key)}
                                            className={
                                                'mt-3 text-xs text-neutral-400 underline underline-offset-2 transition-colors hover:text-neutral-200'
                                            }
                                        >
                                            Undo — remap this category instead
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className={'flex flex-col gap-5 p-5'}>
                                    {/* Header */}
                                    <div className={'border-b border-neutral-700/60 pb-3'}>
                                        <h3 className={'text-sm font-semibold text-slate-50'}>
                                            {activeConflict.category_name}
                                        </h3>
                                    </div>

                                    {/* Issues */}
                                    <div className={'rounded border border-amber-700/30 bg-amber-950/20 p-3'}>
                                        <p
                                            className={
                                                'mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400/80'
                                            }
                                        >
                                            Detected issues
                                        </p>
                                        <ul className={'space-y-1'}>
                                            {activeConflict.issues.map(issue => (
                                                <li
                                                    key={`${activeConflict.category_key}:${issue.field}:${issue.code}`}
                                                    className={'text-sm text-amber-100/80'}
                                                >
                                                    {issue.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {/* Nest */}
                                    <div>
                                        <Label>Nest</Label>
                                        <Select
                                            value={activeState.nestId ?? ''}
                                            onChange={event => {
                                                const nextNestId = Number(event.currentTarget.value);
                                                updateConflictState(activeConflict.category_key, state => ({
                                                    ...state,
                                                    nestId: Number.isNaN(nextNestId) ? null : nextNestId,
                                                    eggId: null,
                                                    allowedEggs: [],
                                                    saved: false,
                                                }));
                                            }}
                                        >
                                            <option value={''}>Select a nest</option>
                                            {nests.map(nest => (
                                                <option key={nest.id} value={nest.id}>
                                                    {nest.name} (#{nest.id})
                                                </option>
                                            ))}
                                        </Select>
                                    </div>

                                    {/* Allowed Eggs */}
                                    <div>
                                        <Label>Allowed Eggs</Label>
                                        <div
                                            className={
                                                'mt-1 max-h-40 overflow-y-auto rounded border border-neutral-700 bg-zinc-900/60 divide-y divide-neutral-700/50'
                                            }
                                        >
                                            {!activeState.nestId ? (
                                                <p className={'px-3 py-2.5 text-sm text-neutral-500'}>
                                                    Pick a nest first.
                                                </p>
                                            ) : loadingNestId === activeState.nestId ? (
                                                <p className={'px-3 py-2.5 text-sm text-neutral-400'}>
                                                    Loading eggs...
                                                </p>
                                            ) : activeNestEggs.length === 0 ? (
                                                <p className={'px-3 py-2.5 text-sm text-amber-300'}>
                                                    No eggs in this nest — choose a different nest.
                                                </p>
                                            ) : (
                                                activeNestEggs.map(egg => (
                                                    <div
                                                        key={egg.id}
                                                        className={'flex items-center justify-between px-3 py-2'}
                                                    >
                                                        <div className={'flex items-center gap-2.5'}>
                                                            <AdminCheckbox
                                                                name={`allowed:${activeConflict.category_key}:${egg.id}`}
                                                                checked={activeState.allowedEggs.includes(egg.id)}
                                                                onChange={event =>
                                                                    toggleAllowedEgg(
                                                                        activeConflict.category_key,
                                                                        egg.id,
                                                                        event.currentTarget.checked,
                                                                    )
                                                                }
                                                            />
                                                            <span className={'text-sm text-neutral-200'}>
                                                                {egg.name}
                                                            </span>
                                                        </div>
                                                        <span className={'text-xs text-neutral-500'}>#{egg.id}</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    {/* Default Egg */}
                                    <div>
                                        <Label>Default Egg</Label>
                                        <Select
                                            value={activeState.eggId ?? ''}
                                            onChange={event => {
                                                const nextEggId = Number(event.currentTarget.value);
                                                updateConflictState(activeConflict.category_key, state => ({
                                                    ...state,
                                                    eggId: Number.isNaN(nextEggId) ? null : nextEggId,
                                                    allowedEggs: state.allowedEggs.includes(nextEggId)
                                                        ? state.allowedEggs
                                                        : [...state.allowedEggs, nextEggId],
                                                    saved: false,
                                                }));
                                            }}
                                            disabled={activeNestEggs.length === 0}
                                        >
                                            <option value={''}>Select default egg</option>
                                            {activeNestEggs
                                                .filter(egg => activeState.allowedEggs.includes(egg.id))
                                                .map(egg => (
                                                    <option key={`default:${egg.id}`} value={egg.id}>
                                                        {egg.name} (#{egg.id})
                                                    </option>
                                                ))}
                                        </Select>
                                    </div>

                                    {/* Apply */}
                                    <div className={'flex justify-end border-t border-neutral-700/60 pt-3'}>
                                        <Button.Info
                                            size={'sm'}
                                            onClick={() => applyConflict(activeConflict.category_key)}
                                            disabled={!canApplyActive}
                                        >
                                            Apply
                                        </Button.Info>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            <Dialog.Footer>
                <Button.Text onClick={onClose}>Cancel</Button.Text>
                {allDone && <span className={'mr-auto text-xs text-green-300'}>All conflicts resolved</span>}
                <Button onClick={submitImport} disabled={!allDone || loading}>
                    {loading ? 'Importing...' : 'Import'}
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
};
