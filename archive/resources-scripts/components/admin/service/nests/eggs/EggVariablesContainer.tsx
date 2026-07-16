import { TrashIcon, PencilIcon } from '@heroicons/react/outline';
import type { FormikHelpers } from 'formik';
import { Form, Formik, getIn, useFormikContext } from 'formik';
import { useState } from 'react';
import tw from 'twin.macro';
import { array, boolean, object, string } from 'yup';

import deleteEggVariable from '@/api/routes/admin/eggs/deleteEggVariable';
import updateEggVariables from '@/api/routes/admin/eggs/updateEggVariables';
import { NoItems } from '@/elements/AdminTable';
import ConfirmationModal from '@/elements/ConfirmationModal';
import type { EggVariable } from '@/api/routes/admin/egg';
import { useEggFromRoute } from '@/api/routes/admin/egg';
import NewVariableButton from '@admin/service/nests/eggs/NewVariableButton';
import { Button } from '@/elements/button';
import Field, { FieldRow, TextareaField } from '@/elements/Field';
import FlashMessageRender from '@/elements/FlashMessageRender';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import useFlash from '@/plugins/useFlash';
import Label from '@/elements/Label';
import { useStoreState } from '@/state/hooks';
import Checkbox from '@/elements/inputs/Checkbox';

const RULE_SUGGESTIONS = ['required', 'nullable', 'string', 'numeric', 'boolean', 'ip', 'alpha_num'];

export const validationSchema = object().shape({
    name: string().required().min(1).max(191),
    description: string(),
    environmentVariable: string().required().min(1).max(191),
    defaultValue: string(),
    isUserViewable: boolean().required(),
    isUserEditable: boolean().required(),
    fieldType: string().oneOf(['text', 'password', 'number', 'boolean']).required(),
    rules: string().required(),
});

function parseRules(input: string): string[] {
    return (input || '')
        .split('|')
        .map(rule => rule.trim())
        .filter(rule => rule.length > 0);
}

function typeBadgeStyles(type: EggVariable['fieldType']) {
    switch (type) {
        case 'password':
            return tw`bg-red-500/10 text-red-300 border border-red-500/40`;
        case 'number':
            return tw`bg-blue-500/10 text-blue-300 border border-blue-500/40`;
        case 'boolean':
            return tw`bg-yellow-500/10 text-yellow-300 border border-yellow-500/40`;
        case 'text':
        default:
            return tw`bg-green-500/10 text-green-300 border border-green-500/40`;
    }
}

function RulesBuilder({ prefix }: { prefix: string }) {
    const { values, setFieldValue } = useFormikContext<any>();
    const current = parseRules(getIn(values, `${prefix}rules`) || '');
    const [draft, setDraft] = useState('');

    const setRules = (next: string[]) => {
        setFieldValue(`${prefix}rules`, next.join('|'));
    };

    return (
        <div css={tw`mb-2`}>
            <Label>Validation Rules</Label>

            <div css={tw`mt-2 flex flex-wrap gap-2`}>
                {current.map(rule => (
                    <button
                        type={'button'}
                        key={rule}
                        onClick={() => setRules(current.filter(item => item !== rule))}
                        css={tw`text-xs rounded px-2 py-1 bg-neutral-900 border border-neutral-700 hover:border-neutral-500`}
                    >
                        {rule} x
                    </button>
                ))}
            </div>

            <div css={tw`grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 mt-3`}>
                <input
                    value={draft}
                    onChange={e => setDraft(e.currentTarget.value)}
                    placeholder={'Add a rule, example: max:255'}
                    css={tw`w-full rounded px-3 py-2 bg-neutral-900 border border-neutral-700 text-neutral-100`}
                />
                <Button
                    type={'button'}
                    onClick={() => {
                        const next = draft.trim();
                        if (!next || current.includes(next)) {
                            return;
                        }
                        setRules([...current, next]);
                        setDraft('');
                    }}
                >
                    Add Rule
                </Button>
            </div>

            <div css={tw`mt-2 flex flex-wrap gap-2`}>
                {RULE_SUGGESTIONS.map(rule => (
                    <Button.Text
                        key={rule}
                        type={'button'}
                        css={[
                            tw`px-2 py-1 text-xs border border-transparent`,
                            current.includes(rule)
                                ? tw`bg-green-500/10 text-green-300 border-green-500/40`
                                : tw`bg-neutral-800 text-neutral-300 border-neutral-700`,
                        ]}
                        onClick={() => {
                            if (!current.includes(rule)) {
                                setRules([...current, rule]);
                            }
                        }}
                    >
                        {rule}
                    </Button.Text>
                ))}
            </div>
        </div>
    );
}

export function EggVariableForm({ prefix, variable }: { prefix: string; variable?: EggVariable }) {
    const { values, setFieldValue } = useFormikContext<any>();

    return (
        <>
            <Field id={`${prefix}name`} name={`${prefix}name`} label={'Name'} type={'text'} css={tw`mb-6`} />

            <TextareaField
                id={`${prefix}description`}
                name={`${prefix}description`}
                label={'Description'}
                rows={3}
                css={tw`mb-4`}
            />

            <FieldRow>
                <Field
                    id={`${prefix}environmentVariable`}
                    name={`${prefix}environmentVariable`}
                    label={'Environment Variable'}
                    type={'text'}
                />

                <Field
                    id={`${prefix}defaultValue`}
                    name={`${prefix}defaultValue`}
                    label={'Default Value'}
                    type={'text'}
                />
            </FieldRow>

            <div css={tw`mb-4`}>
                <Label htmlFor={`${prefix}fieldType`}>Field Type</Label>
                <select
                    id={`${prefix}fieldType`}
                    name={`${prefix}fieldType`}
                    value={values[`${prefix}fieldType`] || 'text'}
                    onChange={e => {
                        setFieldValue(`${prefix}fieldType`, e.currentTarget.value);
                    }}
                    css={tw`w-full mt-2 rounded px-3 py-2 bg-neutral-900 border border-neutral-700 text-neutral-100 focus:border-neutral-500 focus:outline-none`}
                >
                    <option value={'text'}>Text</option>
                    <option value={'password'}>Password</option>
                    <option value={'number'}>Number</option>
                    <option value={'boolean'}>Boolean</option>
                </select>
            </div>

            <div css={tw`flex flex-row mb-6`}>
                <div className="ml-auto flex flex-row items-center">
                    <Field
                        type="checkbox"
                        // @ts-expect-error checkbox rendering
                        as={Checkbox}
                        defaultChecked={variable?.isUserViewable}
                        id={`${prefix}isUserViewable`}
                        name={`${prefix}isUserViewable`}
                    />
                    <div css={tw`flex-1 ml-4`}>
                        <Label>User Viewable</Label>
                    </div>
                </div>

                <div className="ml-auto flex flex-row items-center">
                    <Field
                        type="checkbox"
                        // @ts-expect-error checkbox rendering
                        as={Checkbox}
                        defaultChecked={variable?.isUserEditable}
                        id={`${prefix}isUserEditable`}
                        name={`${prefix}isUserEditable`}
                    />
                    <div css={tw`flex-1 ml-4`}>
                        <Label>User Editable</Label>
                    </div>
                </div>
            </div>

            <RulesBuilder prefix={prefix} />
        </>
    );
}

function EggVariableDeleteButton({ onClick }: { onClick: (success: () => void) => void }) {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const onDelete = () => {
        setLoading(true);
        onClick(() => {
            setLoading(false);
            setVisible(false);
        });
    };

    return (
        <>
            <ConfirmationModal
                visible={visible}
                title={'Delete variable?'}
                buttonText={'Yes, delete variable'}
                onConfirmed={onDelete}
                showSpinnerOverlay={loading}
                onModalDismissed={() => setVisible(false)}
            >
                Are you sure you want to delete this variable? Deleting this variable will delete it from every server
                using this egg.
            </ConfirmationModal>

            <button
                type={'button'}
                css={tw`text-neutral-500 hover:text-red-400 transition-colors`}
                onClick={() => setVisible(true)}
                title={'Delete variable'}
            >
                <TrashIcon className="h-4 w-4" />
            </button>
        </>
    );
}

function EggVariableModal({
    variable,
    prefix,
    onClose,
    onDeleteClick,
}: {
    variable: EggVariable;
    prefix: string;
    onClose: () => void;
    onDeleteClick: (success: () => void) => void;
}) {
    const { isSubmitting } = useFormikContext();

    return (
        <div
            css={tw`fixed inset-0 z-50 flex items-center justify-center bg-black/60`}
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                css={tw`relative bg-neutral-800 border border-neutral-700 rounded-lg w-full max-w-xl mx-4 p-6 shadow-2xl`}
            >
                <SpinnerOverlay visible={isSubmitting} />

                <div css={tw`flex items-center justify-between mb-5`}>
                    <h3 css={tw`text-sm font-semibold text-neutral-100 uppercase tracking-wide font-mono`}>
                        {variable.environmentVariable || variable.name}
                    </h3>
                    <div css={tw`flex items-center gap-3`}>
                        <EggVariableDeleteButton onClick={onDeleteClick} />
                        <button
                            type={'button'}
                            css={tw`text-neutral-500 hover:text-neutral-300 transition-colors`}
                            onClick={onClose}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                <EggVariableForm prefix={prefix} variable={variable} />

                <div css={tw`flex justify-end gap-2 mt-2 pt-4 border-t border-neutral-700`}>
                    <Button.Text type={'button'} onClick={onClose}>
                        Cancel
                    </Button.Text>
                    <Button type={'submit'} disabled={isSubmitting}>
                        Save Changes
                    </Button>
                </div>
            </div>
        </div>
    );
}

function EggVariableRow({
    onDeleteClick,
    variable,
    prefix,
    index,
    onDragStart,
    onDrop,
}: {
    onDeleteClick: (success: () => void) => void;
    variable: EggVariable;
    prefix: string;
    index: number;
    onDragStart: (index: number) => void;
    onDrop: (index: number) => void;
}) {
    const [modalOpen, setModalOpen] = useState(false);
    const rules = parseRules(variable.rules || '');
    const isRequired = rules.includes('required');
    const defaultValue = variable.defaultValue?.trim() || 'none';

    return (
        <>
            <tr
                draggable
                onDragStart={() => onDragStart(index)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(index)}
                css={tw`border-b border-neutral-700 last:border-b-0 hover:bg-neutral-700/30 transition-colors`}
            >
                <td css={tw`px-3 py-3 w-8`}>
                    <span
                        css={tw`text-neutral-600 cursor-move hover:text-neutral-400 select-none text-base`}
                        title={'Drag to reorder'}
                    >
                        ⠿
                    </span>
                </td>

                <td css={tw`px-3 py-3`}>
                    <div css={tw`font-mono text-xs font-semibold text-neutral-100 truncate`}>
                        {variable.environmentVariable || variable.name}
                    </div>
                    {variable.name && variable.environmentVariable && (
                        <div css={tw`text-xs text-neutral-500 mt-0.5 truncate`}>{variable.name}</div>
                    )}
                </td>

                <td css={tw`px-3 py-3 w-24`}>
                    <span css={[tw`text-xs px-2 py-0.5 rounded font-mono`, typeBadgeStyles(variable.fieldType)]}>
                        {variable.fieldType}
                    </span>
                </td>

                <td css={tw`px-3 py-3 w-36`}>
                    <span
                        css={tw`text-xs font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded truncate block max-w-[130px]`}
                    >
                        {defaultValue}
                    </span>
                </td>

                <td css={tw`px-3 py-3`}>
                    <div css={tw`flex flex-wrap gap-1.5`}>
                        {isRequired && (
                            <span
                                css={tw`text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/40`}
                            >
                                required
                            </span>
                        )}
                        {variable.isUserViewable && (
                            <span
                                css={tw`text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/40`}
                            >
                                viewable
                            </span>
                        )}
                        {variable.isUserEditable && (
                            <span
                                css={tw`text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-300 border border-green-500/40`}
                            >
                                editable
                            </span>
                        )}
                    </div>
                </td>

                <td css={tw`px-3 py-3 w-20 text-right`}>
                    <div css={tw`flex items-center justify-end gap-2`}>
                        <button
                            type={'button'}
                            css={tw`inline-flex items-center gap-1.5 text-xs text-neutral-400 border border-neutral-600 hover:border-neutral-400 hover:text-neutral-200 rounded px-2 py-1 transition-colors`}
                            onClick={() => setModalOpen(true)}
                        >
                            <PencilIcon className="h-3 w-3" />
                            Edit
                        </button>

                        <EggVariableDeleteButton
                            onClick={success => {
                                onDeleteClick(success);
                            }}
                        />
                    </div>
                </td>
            </tr>

            {modalOpen && (
                <EggVariableModal
                    variable={variable}
                    prefix={prefix}
                    onClose={() => setModalOpen(false)}
                    onDeleteClick={success => {
                        onDeleteClick(success);
                        setModalOpen(false);
                    }}
                />
            )}
        </>
    );
}

export default function EggVariablesContainer() {
    const { addFlash, clearAndAddHttpError } = useFlash();
    const { data: egg, mutate } = useEggFromRoute();
    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const [dragging, setDragging] = useState<number | null>(null);

    if (!egg) {
        return null;
    }

    const submit = (values: EggVariable[], { setSubmitting }: FormikHelpers<EggVariable[]>) => {
        updateEggVariables(egg.id, values)
            .then(async () => await mutate())
            .catch(error => clearAndAddHttpError({ key: 'egg', error }))
            .then(() => {
                addFlash({ key: 'egg', type: 'success', title: 'Saved', message: 'Variables saved successfully.' });
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={egg.relationships.variables}
            validationSchema={array().of(validationSchema)}
        >
            {({ isSubmitting, isValid, values, setValues }) => (
                <Form>
                    <FlashMessageRender byKey={'egg'} className={'mb-4'} />

                    <div
                        css={tw`rounded-lg border border-neutral-700 shadow-lg overflow-hidden mb-16`}
                        style={{ backgroundColor: secondary }}
                    >
                        <div css={tw`px-4 xl:px-5 py-3 border-b border-neutral-700`}>
                            <div css={tw`flex flex-row gap-3 flex-wrap items-center`}>
                                <NewVariableButton />
                                <span css={tw`text-xs text-neutral-500`}>
                                    {values.length} variable{values.length !== 1 ? 's' : ''}
                                </span>
                                <Button type="submit" className="ml-auto" disabled={isSubmitting || !isValid}>
                                    Save Changes
                                </Button>
                            </div>
                        </div>

                        <div css={tw`px-4 xl:px-5 py-4`}>
                            {values?.length === 0 ? (
                                <NoItems css={tw`bg-neutral-700 rounded-md shadow-md`} />
                            ) : (
                                <div css={tw`rounded-lg border border-neutral-700 overflow-hidden`}>
                                    <table css={tw`w-full text-sm`}>
                                        <thead>
                                            <tr css={tw`border-b border-neutral-700 bg-neutral-800/60`}>
                                                <th css={tw`px-3 py-2 w-8`}></th>
                                                <th
                                                    css={tw`px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide`}
                                                >
                                                    Variable
                                                </th>
                                                <th
                                                    css={tw`px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide w-24`}
                                                >
                                                    Type
                                                </th>
                                                <th
                                                    css={tw`px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide w-36`}
                                                >
                                                    Default
                                                </th>
                                                <th
                                                    css={tw`px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide`}
                                                >
                                                    Flags
                                                </th>
                                                <th css={tw`px-3 py-2 w-20`}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {values.map((v, i) => (
                                                <EggVariableRow
                                                    key={v.id || i}
                                                    index={i}
                                                    prefix={`[${i}].`}
                                                    variable={v}
                                                    onDragStart={index => setDragging(index)}
                                                    onDrop={dropIndex => {
                                                        if (dragging === null || dragging === dropIndex) return;
                                                        const next = [...values];
                                                        const [moved] = next.splice(dragging, 1);
                                                        if (moved) {
                                                            next.splice(dropIndex, 0, moved);
                                                            setValues(next);
                                                        }
                                                        setDragging(null);
                                                    }}
                                                    onDeleteClick={success => {
                                                        deleteEggVariable(egg.id, v.id)
                                                            .then(async () => {
                                                                setValues(
                                                                    values.filter(variable => variable.id !== v.id),
                                                                );
                                                                await mutate(current => ({
                                                                    ...current!,
                                                                    relationships: {
                                                                        ...current!.relationships,
                                                                        variables:
                                                                            current!.relationships.variables!.filter(
                                                                                variable => variable.id !== v.id,
                                                                            ),
                                                                    },
                                                                }));
                                                                success();
                                                            })
                                                            .catch(error =>
                                                                clearAndAddHttpError({ key: 'egg', error }),
                                                            );
                                                    }}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </Form>
            )}
        </Formik>
    );
}
