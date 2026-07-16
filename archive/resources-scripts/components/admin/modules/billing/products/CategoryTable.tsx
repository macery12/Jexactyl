import { useGetCategories, Context as CategoryContext } from '@/api/routes/admin/billing/categories';
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
import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import { Link, NavLink } from 'react-router-dom';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import { useContext, useEffect } from 'react';
import { Button } from '@/elements/button';
import classNames from 'classnames';
import { ShoppingCartIcon } from '@heroicons/react/outline';
import useFlash from '@/plugins/useFlash';
import { CategoryFilters } from '@/api/routes/admin/billing/types';

function CategoryTable() {
    const { data: categories, error } = useGetCategories();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);
    const { setPage, setFilters, sort, setSort, sortDirection } = useContext(CategoryContext);

    const onSearch = (query: string): Promise<void> => {
        return new Promise(resolve => {
            if (query.length < 2) {
                setFilters(null);
            } else {
                setFilters({ name: query });
            }
            return resolve();
        });
    };

    useEffect(() => {
        if (!error) {
            clearFlashes('admin:billing:products');
            return;
        }

        clearAndAddHttpError({ key: 'admin:billing:products', error });
    }, [error]);

    return (
        <>
            <div className={'my-8 flex w-full flex-row items-center px-8'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Categories</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        These categories are used to contain your products.
                    </p>
                </div>
                <div className={'ml-auto flex pl-4'}>
                    <Link to={'/admin/billing/categories/new'}>
                        <Button>Add Category</Button>
                    </Link>
                </div>
            </div>
            <AdminTable>
                <ContentWrapper onSearch={onSearch}>
                    <Pagination data={categories} onPageSelect={setPage}>
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
                                        name={'Name'}
                                        direction={sort === 'name' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('name')}
                                    />
                                    <TableHeader name={'Description'} />
                                    <TableHeader name={'Created At'} />
                                    <TableHeader />
                                </TableHead>
                                <TableBody>
                                    {categories !== undefined &&
                                        categories.items.length > 0 &&
                                        categories.items.map(category => (
                                            <TableRow key={category.id}>
                                                <td css={tw`pl-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    {category.icon ? (
                                                        <img src={category.icon} className={'h-6 w-6 rounded-full'} />
                                                    ) : (
                                                        <ShoppingCartIcon className={'h-6 w-6'} />
                                                    )}
                                                </td>
                                                <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    <CopyOnClick text={category.id}>
                                                        <code css={tw`font-mono bg-neutral-900 rounded py-1 px-2`}>
                                                            {category.id}
                                                        </code>
                                                    </CopyOnClick>
                                                </td>
                                                <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    <NavLink
                                                        to={`/admin/billing/categories/${category.id}`}
                                                        style={{ color: colors.primary }}
                                                        className={'duration-300 hover:brightness-125'}
                                                    >
                                                        {category.name}
                                                    </NavLink>
                                                </td>
                                                <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    {category.description}
                                                </td>
                                                <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    {Math.abs(differenceInHours(category.createdAt, new Date())) > 48
                                                        ? format(category.createdAt, 'MMM do, yyyy h:mma')
                                                        : formatDistanceToNow(category.createdAt, { addSuffix: true })}
                                                </td>
                                                <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                    <span
                                                        className={classNames(
                                                            'inline-flex rounded-full px-2 text-xs font-medium leading-5',
                                                            category.visible
                                                                ? 'bg-green-200 text-green-800'
                                                                : 'bg-red-200 text-red-800',
                                                        )}
                                                    >
                                                        {category.visible ? 'Visible' : 'Hidden'}
                                                    </span>
                                                </td>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </table>
                            {categories === undefined ? <Loading /> : categories.items.length < 1 ? <NoItems /> : null}
                        </div>
                    </Pagination>
                </ContentWrapper>
            </AdminTable>
        </>
    );
}

export default () => {
    const hooks = useTableHooks<CategoryFilters>();

    return (
        <CategoryContext.Provider value={hooks}>
            <CategoryTable />
        </CategoryContext.Provider>
    );
};
