import Spinner from '@/elements/Spinner';
import { Link } from 'react-router-dom';
import { Button } from '@/elements/button';
import { useCategoryFromRoute } from '@/api/routes/admin/billing/categories';
import CategoryForm from '@admin/modules/billing/products/CategoryForm';
import ProductTable from '@admin/modules/billing/products/ProductTable';
import tw from 'twin.macro';
import { ShoppingCartIcon } from '@heroicons/react/outline';

export default () => {
    const { data } = useCategoryFromRoute();

    if (!data) return <Spinner size={'large'} centered />;

    return (
        <>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-8`}>
                {data.icon ? (
                    <img src={data.icon} className={'mr-4 h-8 w-8'} alt={data.name} />
                ) : (
                    <ShoppingCartIcon className={'mr-4 h-8 w-8'} />
                )}
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>{data.name}</h2>
                    <p
                        css={tw`hidden lg:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        {data.description || data.uuid}
                    </p>
                </div>
            </div>
            <CategoryForm category={data} />
            <div css={tw`mt-12 mb-8`}>
                <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-4`}>
                    <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                        <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>Products</h2>
                        <p
                            css={tw`hidden lg:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                        >
                            A list of the available products in the {data.name} category.
                        </p>
                    </div>
                    <div css={tw`flex ml-auto pl-4`}>
                        <Link to={`/admin/billing/categories/${data.id}/products/new`}>
                            <Button>Create Product</Button>
                        </Link>
                    </div>
                </div>
                <ProductTable />
            </div>
        </>
    );
};
