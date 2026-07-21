import type { Filters } from '@/api/routes/admin/databases/getDatabases';
import { Context as DatabasesContext } from '@/api/routes/admin/databases/getDatabases';
import { useTableHooks } from '@/elements/AdminTable';
import DatabasesTable from './DatabasesTable';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/elements/button';
import { PlusIcon } from '@heroicons/react/outline';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { Dialog } from '@/elements/dialog';
import { useState } from 'react';
import createDatabase from '@/api/routes/admin/databases/createDatabase';
import { useStoreActions } from '@/state/hooks';
import { InformationContainer, Values } from '@admin/management/databases/DatabaseEditContainer';
import { FormikHelpers } from 'formik';

interface Props {
    filters?: Filters;
}

export default ({ filters }: Props) => {
    const navigate = useNavigate();
    const hooks = useTableHooks<Filters>(filters);

    const [open, setOpen] = useState<boolean>(false);
    const { clearFlashes, clearAndAddHttpError } = useStoreActions(actions => actions.flashes);

    const submit = ({ name, host, port, username, password }: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes('admin:databases');

        createDatabase(name, host, port, username, password)
            .then(database => navigate(`/admin/databases/${database.id}`))
            .catch(error => clearAndAddHttpError({ key: 'admin:databases', error }))
            .finally(() => setSubmitting(false));
    };

    return (
        <AdminContentBlock>
            <Dialog title={'Create a New Database'} open={open} onClose={() => setOpen(false)} size={'lg'}>
                <InformationContainer title={'Information'} onSubmit={submit} />
            </Dialog>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Database Hosts</h2>
                    <p className={'hidden whitespace-nowrap text-base text-neutral-400 lg:block'}>
                        Modify node database hosts linked to the Panel.
                    </p>
                </div>
                <div className={'mb-4 w-full text-right'}>
                    <Button
                        icon={PlusIcon}
                        size={Button.Sizes.Large}
                        onClick={() => setOpen(true)}
                        className={'h-10 whitespace-nowrap px-4 py-0'}
                    >
                        New Database Host
                    </Button>
                </div>
            </div>
            <DatabasesContext.Provider value={hooks}>
                <DatabasesTable />
            </DatabasesContext.Provider>
        </AdminContentBlock>
    );
};
