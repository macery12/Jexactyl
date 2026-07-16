import Spinner from '@/elements/Spinner';
import { useProductFromRoute } from '@/api/routes/admin/billing/products';
import ProductForm from '@admin/modules/billing/products/ProductForm';

export default () => {
    const { data: product } = useProductFromRoute();

    if (!product) return <Spinner centered />;

    return <ProductForm product={product} />;
};
