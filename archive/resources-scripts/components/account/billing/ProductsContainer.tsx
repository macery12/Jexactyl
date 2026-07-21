import classNames from 'classnames';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { ReactElement, useEffect, useState } from 'react';
import PageContentBlock from '@/elements/PageContentBlock';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    IconDefinition,
    faArchive,
    faDatabase,
    faEthernet,
    faExclamationTriangle,
    faGlobe,
    faHdd,
    faMemory,
    faMicrochip,
    faShoppingBag,
} from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';
import { Alert } from '@/elements/alert';
import { getProducts } from '@/api/routes/account/billing/products';
import { getCategories } from '@/api/routes/account/billing/categories';
import { Category, Product } from '@definitions/account/billing';
import ScopedAlert from '@account/ScopedAlert';

interface LimitProps {
    icon: IconDefinition;
    limit: ReactElement;
}

const LimitBox = ({ icon, limit }: LimitProps) => (
    <div className={'mt-1 text-gray-400'}>
        <FontAwesomeIcon icon={icon} className={'mr-2 h-4 w-4'} />
        {limit}
    </div>
);

export default () => {
    const [category, setCategory] = useState<number>();
    const [products, setProducts] = useState<Product[] | undefined>();
    const [categories, setCategories] = useState<Category[] | undefined>();

    const settings = useStoreState(s => s.everest.data!.billing);
    const { colors } = useStoreState(state => state.theme.data!);

    const availablePaymentMethods = [
        settings.processors?.stripe?.available,
        settings.processors?.paypal?.available,
    ].filter(Boolean).length;

    useEffect(() => {
        (async function () {
            await getCategories().then(data => {
                setCategories(data);
                if (data.length > 0) {
                    setCategory(Number(data[0]!.id));
                } else {
                    setProducts([]);
                }
            });
        })();
    }, []);

    useEffect(() => {
        if (products || !category) return;

        getProducts(category).then(data => {
            setProducts(data);
        });
    }, [category]);

    const hasPaidProducts = !!products?.some(product => Number(product.price) > 0);
    const paidProductsBlocked = hasPaidProducts && availablePaymentMethods < 1;

    return (
        <PageContentBlock title={'Available Products'}>
            <ScopedAlert scope="billing" />
            <div className={'mt-8 mb-12 text-3xl font-bold lg:text-5xl'}>
                Order a Product
                <p className={'mt-1 text-sm font-normal text-gray-400'}>
                    Choose and configure any of the products below to your liking.
                </p>
            </div>
            <div className={'grid gap-4 lg:grid-cols-4 lg:gap-8'}>
                <div className={'lg:border-r-4 lg:border-gray-500'}>
                    <p className={'mb-8 mt-4 text-2xl font-bold text-gray-300'}>Categories</p>
                    {categories && categories.length < 1 && (
                        <div className={'my-4 font-semibold text-gray-400'}>
                            <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-2 h-5 w-5 text-yellow-400'} />
                            There are currently no products available.
                        </div>
                    )}
                    {categories?.map(cat => (
                        <button
                            className={classNames(
                                'my-4 w-full cursor-pointer text-left font-semibold duration-300 hover:brightness-150',
                                Number(cat.id) === category && 'brightness-150',
                            )}
                            disabled={category === Number(cat.id)}
                            style={{ color: colors.primary }}
                            onClick={() => {
                                setCategory(Number(cat.id));
                                setProducts(undefined);
                            }}
                            key={cat.id}
                        >
                            {cat.icon && <img src={cat.icon} className={'mr-3 inline-flex h-7 w-7 rounded-full'} />}
                            {cat.name}
                            <div className={'mt-4 mr-8 h-0.5 rounded-full bg-gray-600'} />
                        </button>
                    ))}
                </div>
                <div className={'lg:col-span-3'}>
                    {!products ? (
                        <Spinner centered />
                    ) : (
                        <>
                            {paidProductsBlocked && (
                                <Alert type={'warning'} className={'mb-4'}>
                                    Payment system has not been setup correctly.
                                </Alert>
                            )}
                            {products?.length < 1 && (
                                <div className={'my-4 font-semibold text-gray-400'}>
                                    <FontAwesomeIcon
                                        icon={faExclamationTriangle}
                                        className={'mr-2 h-5 w-5 text-yellow-400'}
                                    />
                                    There are currently no products available.
                                </div>
                            )}
                            <div className={'grid grid-cols-1 gap-4 xl:grid-cols-3'}>
                                {products?.map(product => (
                                    <ContentBox key={product.id}>
                                        <div className={'p-3 lg:p-6'}>
                                            <div className={'flex justify-center'}>
                                                {product.icon ? (
                                                    <img src={product.icon} className={'h-16 w-16'} />
                                                ) : (
                                                    <FontAwesomeIcon
                                                        icon={faShoppingBag}
                                                        className={'m-2 h-12 w-12'}
                                                        style={{ color: colors.primary }}
                                                    />
                                                )}
                                            </div>
                                            <p className={'mt-3 text-center text-3xl font-bold'}>{product.name}</p>
                                            <p className={'mt-1 mb-4 text-center text-lg font-semibold text-gray-400'}>
                                                <span style={{ color: colors.primary }} className={'mr-1'}>
                                                    {settings.currency.symbol}
                                                    {product.price.toFixed(2)}
                                                    &nbsp;
                                                    {settings.currency.code.toUpperCase()}
                                                </span>
                                                <span className={'text-base'}>/ monthly</span>
                                            </p>
                                            <div className={'grid items-center justify-center'}>
                                                <LimitBox icon={faMicrochip} limit={<>{product.limits.cpu}% CPU</>} />
                                                <LimitBox
                                                    icon={faMemory}
                                                    limit={<>{product.limits.memory / 1024} GiB of RAM</>}
                                                />
                                                <LimitBox
                                                    icon={faHdd}
                                                    limit={<>{product.limits.disk / 1024} GiB of Storage</>}
                                                />
                                                <div className={'my-4 border border-dashed border-gray-500'} />
                                                {product.limits.backup ? (
                                                    <LimitBox
                                                        icon={faArchive}
                                                        limit={<>{product.limits.backup} backup slots</>}
                                                    />
                                                ) : (
                                                    <></>
                                                )}
                                                {product.limits.database ? (
                                                    <LimitBox
                                                        icon={faDatabase}
                                                        limit={<>{product.limits.database} database slots</>}
                                                    />
                                                ) : (
                                                    <></>
                                                )}
                                                <LimitBox
                                                    icon={faEthernet}
                                                    limit={
                                                        <>
                                                            {product.limits.allocation} network port
                                                            {product.limits.allocation > 1 && 's'}
                                                        </>
                                                    }
                                                />
                                                <LimitBox
                                                    icon={faGlobe}
                                                    limit={
                                                        <>
                                                            {product.limits.subdomain === null
                                                                ? 'Unlimited subdomains'
                                                                : `${product.limits.subdomain} subdomain${
                                                                      product.limits.subdomain === 1 ? '' : 's'
                                                                  }`}
                                                        </>
                                                    }
                                                />
                                            </div>
                                            <div className={'mt-6 text-center'}>
                                                {Number(product.price) > 0 && paidProductsBlocked ? (
                                                    <Button size={Button.Sizes.Large} className={'w-full'} disabled>
                                                        Configure
                                                    </Button>
                                                ) : (
                                                    <Link to={`/checkout/configure/${product.id}`}>
                                                        <Button size={Button.Sizes.Large} className={'w-full'}>
                                                            Configure
                                                        </Button>
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    </ContentBox>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </PageContentBlock>
    );
};
