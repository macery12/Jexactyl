import PageContentBlock from '@/elements/PageContentBlock';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faSyncAlt } from '@fortawesome/free-solid-svg-icons';
import styled, { keyframes } from 'styled-components';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import NotFoundSvg from '@/assets/images/not_found.svg';
import ServerErrorSvg from '@/assets/images/server_error.svg';
import { useStoreState } from '@/state/hooks';
import { useNavigate } from 'react-router-dom';
import { lazy, Suspense, useState, useEffect } from 'react';
import Spinner from './Spinner';
import { getProduct, Product } from '@/api/routes/account/billing/products';
import { renewFreeServer } from '@/api/routes/account/billing/orders/process';
import useFlash from '@/plugins/useFlash';
import AdminBypassButton from '@/elements/AdminBypassButton';

const PaymentContainer = lazy(() => import('@server/billing/PaymentContainer'));

interface BaseProps {
    title: string;
    image: string;
    message: string;
    onRetry?: () => void;
    onBack?: () => void;
    children?: React.ReactNode;
}

interface PropsWithRetry extends BaseProps {
    onRetry?: () => void;
    onBack?: never;
}

interface PropsWithBack extends BaseProps {
    onBack?: () => void;
    onRetry?: never;
}

export type ScreenBlockProps = PropsWithBack | PropsWithRetry;

const spin = keyframes`
    to { transform: rotate(360deg) }
`;

const ActionButton = styled(Button)`
    ${tw`rounded-full w-8 h-8 flex items-center justify-center p-0`};

    &.hover\\:spin:hover {
        animation: ${spin} 2s linear infinite;
    }
`;

const ScreenBlock = ({ title, image, message, onBack, onRetry, children }: ScreenBlockProps) => {
    const { secondary } = useStoreState(state => state.theme.data!.colors);

    return (
        <PageContentBlock>
            <div css={tw`flex justify-center`}>
                <div
                    css={tw`w-full sm:w-3/4 md:w-1/2 p-6 sm:p-12 md:p-20 rounded-lg shadow-lg text-center relative`}
                    style={{ backgroundColor: secondary }}
                >
                    {(typeof onBack === 'function' || typeof onRetry === 'function') && (
                        <div css={tw`absolute left-0 top-0 ml-4 mt-4`}>
                            <ActionButton
                                onClick={() => (onRetry ? onRetry() : onBack ? onBack() : null)}
                                className={onRetry ? 'hover:spin' : undefined}
                            >
                                <FontAwesomeIcon icon={onRetry ? faSyncAlt : faArrowLeft} />
                            </ActionButton>
                        </div>
                    )}
                    <img src={image} css={tw`w-2/3 h-auto select-none mx-auto`} />
                    <h2 css={tw`mt-10 text-white font-bold text-4xl`}>{title}</h2>
                    <p css={tw`text-sm text-neutral-400 mt-2`}>{message}</p>
                    {children}
                </div>
            </div>
        </PageContentBlock>
    );
};

type ServerErrorProps = (Omit<PropsWithBack, 'image' | 'title'> | Omit<PropsWithRetry, 'image' | 'title'>) & {
    title?: string;
};

const ServerError = ({ title, ...props }: ServerErrorProps) => (
    <ScreenBlock title={title || 'Something went wrong'} image={ServerErrorSvg} {...props} />
);

const NotFound = ({ title, message, onBack }: Partial<Pick<ScreenBlockProps, 'title' | 'message' | 'onBack'>>) => (
    <ScreenBlock
        title={title || '404'}
        image={NotFoundSvg}
        message={message || 'The requested resource was not found.'}
        onBack={onBack}
    />
);

const Suspended = ({
    date,
    id,
    serverId,
    serverUuid,
    serverStatus,
}: {
    date: Date;
    id?: number;
    serverId?: number;
    serverUuid?: string;
    serverStatus?: string | null;
}) => {
    const [product, setProduct] = useState<Product>();
    const [renewing, setRenewing] = useState<boolean>(false);

    const navigate = useNavigate();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const currency = useStoreState(state => state.everest.data!.billing.currency.symbol);
    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const settings = useStoreState(state => state.everest.data!.billing);
    const rootAdmin = useStoreState(state => state.user.data!.rootAdmin);

    useEffect(() => {
        if (id) {
            getProduct(id)
                .then(data => setProduct(data))
                .catch(error => {
                    console.error(error);
                });
        }
    }, []);

    const handleFreeRenewal = () => {
        if (!product || !id || !serverId || !serverUuid) return;

        setRenewing(true);
        clearFlashes('suspended:billing');

        renewFreeServer(id, serverId)
            .then(() => {
                // Redirect to server overview after successful renewal
                navigate(`/server/${serverUuid}`);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'suspended:billing', error });
                setRenewing(false);
            });
    };

    if (!product) return <Spinner centered />;

    const isFree = product.price === 0;

    // Get configurable renewal settings based on server type
    // Use max_suspension_threshold_days (7 days) as the fixed cutoff for disabling self-service payment
    const suspensionThreshold = isFree
        ? settings.renewal?.free_suspension_days || 7
        : settings.renewal?.max_suspension_threshold_days || 7;

    // Calculate days past the renewal date
    const now = new Date();
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
    const isLongOverdue = daysOverdue > suspensionThreshold;

    return (
        <PageContentBlock>
            <div css={tw`flex justify-center`}>
                <div
                    css={tw`w-full sm:w-3/4 md:w-1/2 p-6 sm:p-12 md:p-20 rounded-lg shadow-lg text-left relative`}
                    style={{ backgroundColor: secondary }}
                >
                    <div css={tw`absolute left-0 top-0 ml-4 mt-4`}>
                        <ActionButton onClick={() => navigate('/')}>
                            <FontAwesomeIcon icon={faArrowLeft} />
                        </ActionButton>
                    </div>
                    {rootAdmin && serverUuid && (
                        <AdminBypassButton
                            serverUuid={serverUuid}
                            bypassType="suspended"
                            serverStatus={serverStatus}
                            position="absolute"
                        />
                    )}
                    <h2 css={tw`text-white font-bold text-4xl`}>Suspended</h2>
                    <p css={tw`text-sm text-neutral-400 mt-2`}>
                        {isFree ? (
                            <>
                                {isLongOverdue ? (
                                    <>
                                        Your free server has been suspended for more than {suspensionThreshold} days due
                                        to non-renewal.{' '}
                                        <span className={'font-bold text-red-400'}>
                                            Please create a support ticket to restore access.
                                        </span>{' '}
                                        Self-service renewal is no longer available after {suspensionThreshold} days.
                                    </>
                                ) : (
                                    <>
                                        Your free server has been suspended because the renewal date has passed. Please
                                        renew to restore access.
                                        <div className={'mt-2 font-semibold text-yellow-400'}>
                                            Days overdue: {daysOverdue}
                                        </div>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                {isLongOverdue ? (
                                    <>
                                        This server has been suspended for more than {suspensionThreshold} days due to
                                        an unpaid balance.{' '}
                                        <span className={'font-bold text-red-400'}>
                                            To restore access, please open a support ticket so our team can assist you.
                                        </span>{' '}
                                        Self-service payments are no longer available after this period.
                                    </>
                                ) : (
                                    <>
                                        Your server has been suspended due to an unpaid balance. Please complete payment
                                        to restore access.
                                        <div className={'mt-4 space-y-2'}>
                                            <div
                                                className={
                                                    'flex items-center justify-between p-3 bg-gray-900/50 rounded border border-gray-700'
                                                }
                                            >
                                                <span className={'text-gray-300 font-medium'}>
                                                    Outstanding Balance:
                                                </span>
                                                <span className={'text-white font-bold text-lg'}>
                                                    {currency}
                                                    {product.price.toFixed(2)}
                                                </span>
                                            </div>
                                            <div
                                                className={
                                                    'flex items-center justify-between p-3 bg-yellow-900/20 rounded border border-yellow-700/50'
                                                }
                                            >
                                                <span className={'text-yellow-300 font-medium'}>Days Overdue:</span>
                                                <span className={'text-yellow-400 font-bold text-lg'}>
                                                    {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'}
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </p>
                    <div className={'mt-6'}>
                        {isLongOverdue ? (
                            <div css={tw`text-center p-4 bg-red-900/30 rounded border border-red-500`}>
                                <p css={tw`text-red-300 font-semibold`}>
                                    Self-service renewal/payment is no longer available. Please create a support ticket
                                    to restore your server.
                                </p>
                            </div>
                        ) : (
                            <>
                                {isFree ? (
                                    <Button onClick={handleFreeRenewal} disabled={renewing} size={Button.Sizes.Large}>
                                        {renewing ? 'Renewing...' : 'Renew Free Server'}
                                    </Button>
                                ) : (
                                    <div className={'space-y-4'}>
                                        <div className={'bg-gray-900/30 rounded-lg border border-gray-700 p-4'}>
                                            <h3 className={'text-white font-bold text-lg mb-3'}>
                                                Complete Your Payment
                                            </h3>
                                            <div className={'space-y-2 text-sm'}>
                                                <div className={'flex justify-between items-center'}>
                                                    <span className={'text-gray-400'}>Product:</span>
                                                    <span className={'text-white font-medium'}>{product.name}</span>
                                                </div>
                                                <div className={'flex justify-between items-center'}>
                                                    <span className={'text-gray-400'}>Renewal Period:</span>
                                                    <span className={'text-white font-medium'}>
                                                        {settings.renewal?.days || 30} days
                                                    </span>
                                                </div>
                                                <div className={'border-t border-gray-700 pt-2 mt-2'}>
                                                    <div className={'flex justify-between items-center'}>
                                                        <span className={'text-gray-300 font-semibold'}>
                                                            Total Amount:
                                                        </span>
                                                        <span className={'text-white font-bold text-xl'}>
                                                            {currency}
                                                            {product.price.toFixed(2)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <Suspense fallback={<Spinner centered />}>
                                            <PaymentContainer id={Number(product.id)} />
                                        </Suspense>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </PageContentBlock>
    );
};

export { ServerError, NotFound, Suspended };
export default ScreenBlock;
