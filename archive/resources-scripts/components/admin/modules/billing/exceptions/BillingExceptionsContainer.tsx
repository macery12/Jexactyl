import AdminContentBlock from '@/elements/AdminContentBlock';
import { resolveAllBillingExceptions } from '@/api/routes/admin/billing/exceptions';
import BillingExceptionsTable from './BillingExceptionsTable';
import { Button } from '@/elements/button';
import { CheckCircleIcon } from '@heroicons/react/outline';

export default () => {
    const onResolveAll = () => {
        if (confirm('Are you sure you want to resolve all billing exceptions? This action cannot be undone.')) {
            resolveAllBillingExceptions().then(() => window.location.reload());
        }
    };

    return (
        <AdminContentBlock title={'Billing Exceptions'}>
            <div className={'flex w-full flex-row items-center p-8'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Billing Exceptions</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        View and resolve errors from payment processing, server deployment, and webhook handling.
                        Exceptions are automatically logged when billing operations fail.
                    </p>
                </div>
                <div className={'ml-auto pl-4'}>
                    <Button onClick={onResolveAll}>
                        <CheckCircleIcon className={'mr-1 mt-0.5 inline-flex h-5 w-5'} /> Resolve All
                    </Button>
                </div>
            </div>
            <BillingExceptionsTable />
        </AdminContentBlock>
    );
};
