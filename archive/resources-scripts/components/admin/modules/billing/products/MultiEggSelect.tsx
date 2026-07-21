import { useField } from 'formik';
import { useEffect, useState } from 'react';
import tw from 'twin.macro';

import type { WithRelationships } from '@/api/routes/admin';
import type { Egg } from '@/api/routes/admin/egg';
import { searchEggs } from '@/api/routes/admin/egg';
import Label from '@/elements/Label';
import AdminCheckbox from '@/elements/AdminCheckbox';
import { useStoreState } from '@/state/hooks';

interface Props {
    nestId?: number;
    selectedEggIds?: number[];
    onEggSelectionChange: (eggIds: number[]) => void;
}

export default ({ nestId, selectedEggIds = [], onEggSelectionChange }: Props) => {
    const [, , { setValue: setEggIdValue, setTouched: setEggIdTouched }] = useField<number>('eggId');
    const [, , { setValue: setAllowedEggsValue, setTouched: setAllowedEggsTouched }] =
        useField<number[]>('allowedEggs');
    const [eggs, setEggs] = useState<WithRelationships<Egg, 'variables'>[] | undefined>(undefined);
    const [selected, setSelected] = useState<number[]>(selectedEggIds);
    const theme = useStoreState(state => state.theme.data!);

    useEffect(() => {
        if (!nestId) {
            setEggs(undefined);
            return;
        }

        searchEggs(nestId, {})
            .then(_eggs => {
                setEggs(_eggs);

                const validEggIds = new Set(_eggs.map(egg => egg.id));
                const initialSelection = selectedEggIds.filter(id => validEggIds.has(id));

                let nextSelected = initialSelection;
                if (nextSelected.length === 0 && _eggs.length > 0) {
                    nextSelected = [_eggs[0]!.id!];
                }

                setSelected(nextSelected);
                if (nextSelected.length > 0) {
                    setEggIdValue(nextSelected[0]!);
                    setEggIdTouched(true);
                    setAllowedEggsValue(nextSelected);
                    setAllowedEggsTouched(true);
                    onEggSelectionChange(nextSelected);
                }
            })
            .catch(error => console.error(error));
    }, [nestId]);

    useEffect(() => {
        if (!eggs) {
            return;
        }

        const validEggIds = new Set(eggs.map(egg => egg.id));
        let filtered = selectedEggIds.filter(id => validEggIds.has(id));

        if (filtered.length === 0 && eggs.length > 0) {
            filtered = [eggs[0]!.id!];
        }

        const isSameSelection =
            filtered.length === selectedEggIds.length && filtered.every((id, index) => id === selectedEggIds[index]);

        if (filtered.length > 0 && !isSameSelection) {
            setSelected(filtered);
            setEggIdValue(filtered[0]!);
            setEggIdTouched(true);
            setAllowedEggsValue(filtered);
            setAllowedEggsTouched(true);
            onEggSelectionChange(filtered);
        }
    }, [selectedEggIds, eggs]);

    const handleEggToggle = (eggId: number, checked: boolean) => {
        let newSelected: number[];

        if (!eggs?.some(egg => egg.id === eggId)) {
            return;
        }

        if (checked) {
            // Add egg to selection
            newSelected = [...selected, eggId];
        } else {
            // Remove egg from selection (but ensure at least one remains)
            newSelected = selected.filter(id => id !== eggId);
            if (newSelected.length === 0) {
                // Don't allow deselecting the last egg
                return;
            }
        }

        setSelected(newSelected);

        // Update form values
        setEggIdValue(newSelected[0]!); // Primary egg is the first one
        setEggIdTouched(true);
        setAllowedEggsValue(newSelected);
        setAllowedEggsTouched(true);

        onEggSelectionChange(newSelected);
    };

    return (
        <>
            <Label>Allowed Eggs</Label>
            <p css={tw`text-xs text-neutral-400 mb-3`}>
                Select one or more eggs that users can choose from in this category. The first selected egg will be the
                default.
            </p>
            <div css={tw`space-y-2`}>
                {!eggs ? (
                    <p css={tw`text-sm text-neutral-400`}>Loading eggs...</p>
                ) : eggs.length === 0 ? (
                    <p css={tw`text-sm text-neutral-400`}>No eggs available in this nest.</p>
                ) : (
                    eggs.map(egg => (
                        <div
                            key={egg.id}
                            css={tw`flex items-center space-x-2 p-3 rounded shadow-md transition duration-200`}
                            style={{
                                backgroundColor: selected.includes(egg.id)
                                    ? theme.colors.headers
                                    : theme.colors.secondary,
                            }}
                            className={'hover:brightness-110'}
                        >
                            <AdminCheckbox
                                name={`egg-${egg.id}`}
                                checked={selected.includes(egg.id)}
                                onChange={e => handleEggToggle(egg.id, e.target.checked)}
                            />
                            <label htmlFor={`egg-${egg.id}`} css={tw`flex-1 cursor-pointer text-sm`}>
                                {egg.name}
                                {selected[0] === egg.id && (
                                    <span css={tw`ml-2 text-xs`} style={{ color: theme.colors.primary }}>
                                        (Primary)
                                    </span>
                                )}
                            </label>
                        </div>
                    ))
                )}
            </div>
            {selected.length > 1 && (
                <p css={tw`text-xs text-neutral-400 mt-2`}>
                    {selected.length} eggs selected. Users will be able to choose between them during checkout.
                </p>
            )}
        </>
    );
};
