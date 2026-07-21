import { useGetCoupons, Context as CouponContext } from '@/api/routes/admin/billing/coupons';
import AdminTable, {
    ContentWrapper,
    Loading,
    NoItems,
    Pagination,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
    useTableHooks,
} from '@/elements/AdminTable';
import CopyOnClick from '@/elements/CopyOnClick';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import { useContext, useEffect } from 'react';
import { Button } from '@/elements/button';
import { TicketIcon } from '@heroicons/react/outline';
import useFlash from '@/plugins/useFlash';
import { CouponFilters } from '@/api/routes/admin/billing/types';

function CouponsContainer() {
    const { data: coupons, error } = useGetCoupons();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);
    const { setPage, setFilters, sort, setSort, sortDirection, filters } = useContext(CouponContext);

    const onSearch = (query: string): Promise<void> => {
        return new Promise(resolve => {
            if (query.length < 2) {
                setFilters(null);
            } else {
                setFilters({ code: query });
            }
            resolve();
        });
    };

    useEffect(() => {
        if (!error) {
            clearFlashes('admin:billing:coupons');
            return;
        }

        clearAndAddHttpError({ key: 'admin:billing:coupons', error });
    }, [error]);

    return (
        <>
            <div className={'my-8 flex w-full flex-col items-start gap-2 px-4 sm:flex-row sm:items-center sm:px-8'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Coupons</h2>
                    <p className={'hidden overflow-hidden whitespace-nowrap text-base text-neutral-400 lg:block'}>
                        Manage discount coupons for the billing system.
                    </p>
                </div>
                <div className={'ml-auto flex pl-4'}>
                    <Link to={'/admin/billing/coupons/new'}>
                        <Button>Add Coupon</Button>
                    </Link>
                </div>
            </div>

            <AdminTable>
                <ContentWrapper onSearch={onSearch}>
                    <Pagination data={coupons} onPageSelect={setPage}>
                        <div css={tw`overflow-x-auto`}>
                            <table css={tw`w-full table-auto`}>
                                <TableHead>
                                    <TableHeader />
                                    <TableHeader
                                        name={'ID'}
                                        direction={sort === 'id' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('id')}
                                    />
                                    <TableHeader
                                        name={'Code'}
                                        direction={sort === 'code' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('code')}
                                    />
                                    <TableHeader
                                        name={'Type'}
                                        direction={sort === 'type' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('type')}
                                    />
                                    <TableHeader
                                        name={'Value'}
                                        direction={sort === 'value' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('value')}
                                    />
                                    <TableHeader
                                        name={'Usage'}
                                        direction={sort === 'usage_count' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('usage_count')}
                                    />
                                    <TableHeader
                                        name={'Status'}
                                        direction={sort === 'is_active' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('is_active')}
                                    />
                                    <TableHeader
                                        name={'Expires At'}
                                        direction={sort === 'expires_at' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('expires_at')}
                                    />
                                </TableHead>

                                <TableBody>
                                    {coupons !== undefined &&
                                        !coupons.items.length &&
                                        ((!filters || Object.keys(filters).length === 0 ? (
                                            <tr>
                                                <td colSpan={8}>
                                                    <NoItems />
                                                </td>
                                            </tr>
                                        ) : (
                                            <tr>
                                                <td colSpan={8}>
                                                    <div css={tw`text-center text-sm text-neutral-400`}>
                                                        No coupons found matching your search.
                                                    </div>
                                                </td>
                                            </tr>
                                        )) as any)}

                                    {coupons === undefined ? (
                                        <Loading />
                                    ) : (
                                        coupons.items.map(coupon => (
                                            <TableRow key={coupon.id}>
                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    <Link to={`/admin/billing/coupons/${coupon.id}`}>
                                                        <TicketIcon
                                                            color={colors.primary}
                                                            css={tw`h-5 w-5 cursor-pointer`}
                                                        />
                                                    </Link>
                                                </td>

                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    <Link to={`/admin/billing/coupons/${coupon.id}`}>
                                                        <CopyOnClick text={coupon.id.toString()}>
                                                            <code
                                                                css={tw`font-mono text-xs bg-neutral-900 rounded py-1 px-2`}
                                                            >
                                                                {coupon.id}
                                                            </code>
                                                        </CopyOnClick>
                                                    </Link>
                                                </td>

                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    <CopyOnClick text={coupon.code}>
                                                        <code css={tw`font-bold cursor-pointer`}>{coupon.code}</code>
                                                    </CopyOnClick>
                                                </td>

                                                <td
                                                    css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap capitalize`}
                                                >
                                                    {coupon.type}
                                                </td>

                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    {coupon.type === 'percentage'
                                                        ? `${coupon.value}%`
                                                        : `$${coupon.value}`}
                                                </td>

                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    {coupon.usageCount}
                                                    {coupon.maxUses ? ` / ${coupon.maxUses}` : ''}
                                                </td>

                                                {/* ✅ STATUS BADGE (same as Nodes) */}
                                                <td css={tw`px-6 whitespace-nowrap`}>
                                                    {coupon.isActive ? (
                                                        <span
                                                            css={tw`px-2 inline-flex text-xs leading-5 font-medium rounded-full bg-green-100 text-green-800`}
                                                        >
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span
                                                            css={tw`px-2 inline-flex text-xs leading-5 font-medium rounded-full bg-red-200 text-red-800`}
                                                        >
                                                            Inactive
                                                        </span>
                                                    )}
                                                </td>

                                                <td css={tw`px-6 text-sm text-neutral-200 whitespace-nowrap`}>
                                                    {coupon.expiresAt
                                                        ? format(coupon.expiresAt, 'MMM dd, yyyy')
                                                        : 'Never'}
                                                </td>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </table>
                        </div>
                    </Pagination>
                </ContentWrapper>
            </AdminTable>
        </>
    );
}

export default () => {
    const hooks = useTableHooks<CouponFilters>();

    return (
        <CouponContext.Provider value={hooks}>
            <CouponsContainer />
        </CouponContext.Provider>
    );
};
