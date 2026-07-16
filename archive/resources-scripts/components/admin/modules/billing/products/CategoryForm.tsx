import type { Actions } from 'easy-peasy';
import { useStoreActions } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Form, Formik, useFormikContext } from 'formik';
import { useNavigate, useParams } from 'react-router-dom';
import Field, { FieldRow } from '@/elements/Field';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import type { ApplicationStore } from '@/state';
import AdminBox from '@/elements/AdminBox';
import { createCategory, updateCategory } from '@/api/routes/admin/billing/categories';
import { object, string, boolean, number, array } from 'yup';
import { faShoppingBasket } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import Label from '@/elements/Label';
import { Dispatch, SetStateAction, useState, useEffect } from 'react';
import { ShoppingCartIcon } from '@heroicons/react/outline';
import CategoryDeleteButton from './CategoryDeleteButton';
import { Category } from '@definitions/admin';
import { CategoryValues } from '@/api/routes/admin/billing/types';
import { useSWRConfig } from 'swr';
import NestSelector from '@admin/management/servers/NestSelector';
import MultiEggSelect from './MultiEggSelect';
import AdminCheckbox from '@/elements/AdminCheckbox';

interface Props {
    visible: boolean;
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
    category?: Category;
    setVisible: Dispatch<SetStateAction<boolean>>;
    setAllowEggChanges: Dispatch<SetStateAction<boolean>>;
    setAllowPlanChanges: Dispatch<SetStateAction<boolean>>;
}

function InternalForm({
    category,
    visible,
    setVisible,
    allowEggChanges,
    setAllowEggChanges,
    allowPlanChanges,
    setAllowPlanChanges,
}: Props) {
    const { isSubmitting } = useFormikContext<CategoryValues>();
    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const [nestId, setNestId] = useState<number>(category?.nestId ?? 0);
    const [selectedEggIds, setSelectedEggIds] = useState<number[]>(
        category?.allowedEggs ?? (category?.eggId ? [category.eggId] : []),
    );

    return (
        <Form>
            <div css={tw`grid grid-cols-1 lg:grid-cols-2 gap-4`}>
                <div css={tw`w-full flex flex-col mr-0 lg:mr-2`}>
                    <AdminBox title={'Category Details'} icon={faShoppingBasket} isLoading={isSubmitting}>
                        <FieldRow>
                            <Field
                                id={'name'}
                                name={'name'}
                                type={'text'}
                                placeholder={'Minecraft Java'}
                                label={'Category Name'}
                                description={'A simple title for this category.'}
                            />
                            <Field
                                id={'description'}
                                name={'description'}
                                type={'text'}
                                placeholder={'With support for 1.21'}
                                label={'Description'}
                                description={'A tagline or description for this product category.'}
                            />
                            <Field
                                id={'icon'}
                                name={'icon'}
                                type={'text'}
                                label={'Icon'}
                                description={'An icon to be displayed with this category.'}
                            />
                            <div className={'mt-1'}>
                                <Label htmlFor={'visible'}>Visible on creation</Label>
                                <div className={'mt-1'}>
                                    <label css={tw`inline-flex items-center mr-2`}>
                                        <Field
                                            name={'visible'}
                                            type={'radio'}
                                            value={'false'}
                                            checked={!visible}
                                            onClick={() => setVisible(false)}
                                        />
                                        <span css={tw`text-neutral-300 ml-2`}>No</span>
                                    </label>

                                    <label css={tw`inline-flex items-center ml-2`}>
                                        <Field
                                            name={'visible'}
                                            type={'radio'}
                                            value={'true'}
                                            checked={visible}
                                            onClick={() => setVisible(true)}
                                        />
                                        <span css={tw`text-neutral-300 ml-2`}>Yes</span>
                                    </label>
                                </div>
                                <p className={'mt-3 text-xs'}>Should this category be visible instantly?</p>
                            </div>
                            <div className={'mt-4'}>
                                <Label>Allow users to change eggs after purchase</Label>
                                <div css={tw`flex items-center mt-2`}>
                                    <AdminCheckbox
                                        name={'allowEggChanges'}
                                        checked={allowEggChanges}
                                        onChange={e => setAllowEggChanges(e.target.checked)}
                                    />
                                    <span css={tw`ml-2 text-sm text-neutral-300`}>
                                        {allowEggChanges ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>
                                <p className={'mt-2 text-xs text-neutral-400'}>
                                    When enabled, users can change their server&apos;s egg to any other allowed egg in
                                    this category.
                                </p>
                            </div>
                            <div className={'mt-4'}>
                                <Label>Allow users to change billing plans after purchase</Label>
                                <div css={tw`flex items-center mt-2`}>
                                    <AdminCheckbox
                                        name={'allowPlanChanges'}
                                        checked={allowPlanChanges}
                                        onChange={e => setAllowPlanChanges(e.target.checked)}
                                    />
                                    <span css={tw`ml-2 text-sm text-neutral-300`}>
                                        {allowPlanChanges ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>
                                <p className={'mt-2 text-xs text-neutral-400'}>
                                    When enabled, users can upgrade or downgrade to other plans in this category.
                                </p>
                            </div>
                        </FieldRow>
                    </AdminBox>
                </div>
                <div css={tw`w-full flex flex-col mr-0 lg:mr-2`}>
                    <AdminBox title={'Egg Selection'} isLoading={isSubmitting}>
                        <div className={'mb-6'}>
                            <NestSelector selectedNestId={nestId} onNestSelect={setNestId} />
                        </div>
                        <div className={'mb-6'}>
                            <MultiEggSelect
                                nestId={nestId}
                                selectedEggIds={selectedEggIds}
                                onEggSelectionChange={setSelectedEggIds}
                            />
                        </div>
                    </AdminBox>
                    <div css={tw`rounded shadow-md mt-4 py-2 pr-6`} style={{ backgroundColor: secondary }}>
                        <div css={tw`text-right`}>
                            {category && <CategoryDeleteButton category={category} />}
                            <Button type={'submit'} css={tw`ml-4`}>
                                {category ? 'Update' : 'Create'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Form>
    );
}

export default ({ category }: { category?: Category }) => {
    const navigate = useNavigate();
    const params = useParams<'id'>();
    const { mutate } = useSWRConfig();
    const [visible, setVisible] = useState<boolean>(category?.visible ?? false);
    const [allowEggChanges, setAllowEggChanges] = useState<boolean>(category?.allowEggChanges ?? true);
    const [allowPlanChanges, setAllowPlanChanges] = useState<boolean>(category?.allowPlanChanges ?? true);

    // Sync state when category data changes from server
    useEffect(() => {
        setVisible(category?.visible ?? false);
        setAllowEggChanges(category?.allowEggChanges ?? true);
        setAllowPlanChanges(category?.allowPlanChanges ?? true);
    }, [category?.id, category?.visible, category?.allowEggChanges, category?.allowPlanChanges]);

    const { clearFlashes, clearAndAddHttpError } = useStoreActions(
        (actions: Actions<ApplicationStore>) => actions.flashes,
    );

    const submit = (values: CategoryValues, { setSubmitting }: FormikHelpers<CategoryValues>) => {
        clearFlashes('admin:billing:category:create');

        values.visible = visible;
        values.allowEggChanges = allowEggChanges;
        values.allowPlanChanges = allowPlanChanges;

        createCategory(values)
            .then(data => navigate(`/admin/billing/categories/${data.id}`))
            .catch(error => {
                console.error(error);
                clearAndAddHttpError({ key: 'admin:billing:category:create', error });
            })
            .then(() => setSubmitting(false));
    };

    const update = (values: CategoryValues, { setSubmitting }: FormikHelpers<CategoryValues>) => {
        clearFlashes();

        values.visible = visible;
        values.allowEggChanges = allowEggChanges;
        values.allowPlanChanges = allowPlanChanges;

        updateCategory(category!.id, values)
            .then(async () => {
                // Revalidate the SWR cache to fetch updated category data and wait for it to complete
                await mutate(`/api/application/billing/categories/${params.id}`, undefined, { revalidate: true });
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:billing:category:create', error });
            })
            .then(() => setSubmitting(false));
    };

    const formContent = (
        <Formik
            onSubmit={category ? update : (submit as any)}
            enableReinitialize={true}
            initialValues={{
                name: category?.name ?? '',
                icon: category?.icon ?? '',
                description: category?.description ?? '',
                visible: category?.visible ?? false,
                eggId: category?.eggId ?? 0,
                allowedEggs: category?.allowedEggs ?? (category?.eggId ? [category.eggId] : []),
                allowEggChanges: category?.allowEggChanges ?? true,
                allowPlanChanges: category?.allowPlanChanges ?? true,
            }}
            validationSchema={object().shape({
                name: string().required().max(191).min(3),
                icon: string().nullable().max(191).min(3),
                description: string().nullable().max(191).min(3),
                visible: boolean().required(),
                nestId: number(),
                eggId: number().required(),
                allowedEggs: array().of(number()).min(1).required(),
                allowEggChanges: boolean(),
                allowPlanChanges: boolean(),
            })}
        >
            <InternalForm
                category={category}
                visible={visible}
                setVisible={setVisible}
                allowEggChanges={allowEggChanges}
                setAllowEggChanges={setAllowEggChanges}
                allowPlanChanges={allowPlanChanges}
                setAllowPlanChanges={setAllowPlanChanges}
            />
        </Formik>
    );

    // When editing an existing category, return just the form (parent provides AdminContentBlock)
    if (category) {
        return formContent;
    }

    // When creating a new category, return form with header (parent BillingRouter provides AdminContentBlock)
    return (
        <>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-8`}>
                <ShoppingCartIcon className={'mr-4 h-8 w-8'} />
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>New Product Category</h2>
                    <p
                        css={tw`hidden lg:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        Add a new category to the billing interface.
                    </p>
                </div>
            </div>
            {formContent}
        </>
    );
};
