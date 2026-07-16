import AdminContentBlock from '@/elements/AdminContentBlock';
import OrdersTable from './OrdersTable';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';

export default () => (
    <AdminContentBlock title={'Billing Orders'}>
        <div className={'flex w-full flex-col items-start gap-2 p-4 sm:flex-row sm:items-center sm:p-8'}>
            <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Orders</h2>
                <p
                    className={
                        'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                    }
                >
                    A list of the orders placed on this Panel.
                </p>
            </div>
        </div>
        <OrdersTable />
    </AdminContentBlock>
);
