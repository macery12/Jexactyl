import Spinner from '@/elements/Spinner';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStoreState } from '@/state/hooks';
import NodeBox from '@account/billing/order/NodeBox';
import EggBox from '@account/billing/order/EggBox';
import BillingCycleBox from '@account/billing/order/BillingCycleBox';
import PageContentBlock from '@/elements/PageContentBlock';
import VariableBox from '@account/billing/order/VariableBox';
import SubtotalCard from '@account/billing/order/SubtotalCard';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons';
import { Alert } from '@/elements/alert';
import useFlash from '@/plugins/useFlash';
import { EggVariable } from '@definitions/server';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { Product, type Node } from '@definitions/account/billing';
import {
    getProduct,
    getProductVariables,
    getViableNodes,
    getEggInfo,
    getProductBillingCycles,
    type EggInfo,
    type BillingCycle,
} from '@/api/routes/account/billing/products';
import AdminCheckbox from '@/elements/AdminCheckbox';
import { ValidateCouponResponse } from '@/api/routes/account/billing/coupons';
import { AvailableCustomDomain, getAvailableCustomDomains } from '@/api/routes/account/billing/customDomains';
import { processUnpaidOrder } from '@/api/routes/account/billing/orders/process';
import { getBillingProfile, type BillingProfile } from '@/api/routes/account/billing/billingProfile';
import classNames from 'classnames';
import { useCheckoutDraft } from '@/hooks/useCheckoutDraft';

const getResponseStatus = (reason: unknown): number | undefined => {
    if (typeof reason === 'object' && reason !== null) {
        const response = (reason as { response?: { status?: number } }).response;
        return response?.status;
    }
    return undefined;
};

export default () => {
    const params = useParams<'id'>();
    const productId = params.id ? Number(params.id) : 0;

    const vars = useRef(new Map<string, string>()).current;
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const navigate = useNavigate();

    const billing = useStoreState(state => state.everest.data!.billing);
    const { setDraft } = useCheckoutDraft(productId);
    const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
    const [selectedBillingDays, setSelectedBillingDays] = useState<number>(30);
    const [nodes, setNodes] = useState<Node[] | undefined>();
    const [selectedNode, setSelectedNode] = useState<number>(0);
    const [product, setProduct] = useState<Product | undefined>();
    const [eggs, setEggs] = useState<EggVariable[] | undefined>();
    const [selectedEggId, setSelectedEggId] = useState<number | undefined>();
    const [availableEggs, setAvailableEggs] = useState<EggInfo[]>([]);

    const [couponData, setCouponData] = useState<ValidateCouponResponse | null>(null);
    const [serverName, setServerName] = useState<string>('');
    const [serverNameTouched, setServerNameTouched] = useState<boolean>(false);
    const [legalAgreed, setLegalAgreed] = useState<boolean>(false);
    const [checkingBillingAddress, setCheckingBillingAddress] = useState<boolean>(false);

    const hasValidSelectedNode = Number.isInteger(selectedNode) && selectedNode > 0;
    const hasEditableVariables = eggs?.some(v => v.isEditable) ?? false;

    const [_customDomainOptions, setCustomDomainOptions] = useState<AvailableCustomDomain[]>([]);
    const [domainMappings, _setDomainMappings] = useState<
        Array<{
            domain_id: number;
            domain: string;
            subdomain: string;
            record_type: 'srv' | 'cname';
        }>
    >([]);
    const [selectedDomainId, setSelectedDomainId] = useState<number>(0);
    const [_mappingSubdomain, _setMappingSubdomain] = useState<string>('');
    const [_mappingRecordType, setMappingRecordType] = useState<'srv' | 'cname'>('cname');

    // Wizard step state
    const [_currentStep, _setCurrentStep] = useState<number>(1);

    const { colors } = useStoreState(state => state.theme.data!);

    // Auto-generate server name
    const generateServerName = useCallback(() => {
        if (!product || !selectedNode || !selectedEggId) return '';

        const selectedEgg = availableEggs.find(e => e.id === selectedEggId);
        const node = nodes?.find(n => Number(n.id) === selectedNode);

        if (!selectedEgg || !node) return '';

        const eggName = selectedEgg.name.split(' ')[0] || 'Server';
        const nodePrefix = node.name.split('-')[0] || 'Node';
        const timestamp = Date.now().toString().slice(-6);

        return `${eggName}-${nodePrefix}-${timestamp}`;
    }, [product, selectedNode, selectedEggId, availableEggs, nodes]);

    const getCurrentPrice = () => {
        const selectedCycle = billingCycles.find(c => c.days === selectedBillingDays);
        return selectedCycle ? selectedCycle.price : (product?.price ?? 0);
    };

    const calculatedOrderTotal = couponData ? couponData.total : getCurrentPrice();
    const totalIsFree = calculatedOrderTotal === 0;

    const pricingComplete = hasValidSelectedNode && !!selectedBillingDays;
    const softwareComplete = availableEggs.length > 0 && selectedEggId !== undefined;
    const configurationComplete = serverName.trim() !== '';
    const reviewReady = pricingComplete && softwareComplete && configurationComplete && legalAgreed;

    const handleCouponApplied = (data: ValidateCouponResponse | null, status: 'applied' | 'removed' | 'invalid') => {
        if (status === 'invalid') return;
        setCouponData(data);
    };

    const getDomainPayload = () =>
        domainMappings.map(mapping => ({
            domain_id: mapping.domain_id,
            subdomain: mapping.subdomain,
            record_type: mapping.record_type,
        }));

    const hasCompleteBillingProfile = (profile: BillingProfile | null): boolean => {
        if (!profile) {
            return false;
        }

        const requiredFields = [
            profile.first_name,
            profile.last_name,
            profile.address_line1,
            profile.city,
            profile.state,
            profile.postal_code,
            profile.country,
        ];

        return requiredFields.every(value => typeof value === 'string' && value.trim().length > 0);
    };

    const assertBillingAddressBeforeCheckout = async (): Promise<boolean> => {
        if (!billing.require_billing_address) {
            return true;
        }

        setCheckingBillingAddress(true);

        try {
            const profile = await getBillingProfile();

            if (hasCompleteBillingProfile(profile)) {
                return true;
            }

            clearFlashes('account:billing:order');
            addFlash({
                key: 'account:billing:order',
                type: 'error',
                message:
                    'Billing address verification is required before purchase. Please add your billing address in Account Overview, then continue to payment.',
            });

            return false;
        } catch (error) {
            clearAndAddHttpError({ key: 'account:billing:order', error });
            return false;
        } finally {
            setCheckingBillingAddress(false);
        }
    };

    const createFree = async () => {
        if (product && serverName.trim()) {
            const canContinue = await assertBillingAddressBeforeCheckout();
            if (!canContinue) {
                return;
            }

            const variables = Array.from(vars, ([key, value]) => ({ key, value }));
            processUnpaidOrder(
                product.id,
                selectedNode,
                undefined,
                variables,
                undefined,
                couponData?.coupon.id,
                selectedEggId,
                serverName.trim(),
                getDomainPayload(),
                selectedBillingDays,
            )
                .then(() => navigate('/'))
                .catch((error: any) => clearAndAddHttpError({ key: 'account:billing:order', error }));
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch product details
                const productData = await getProduct(Number(params.id));
                setProduct(productData);

                // Fetch billing cycles
                const cyclesData = await getProductBillingCycles(Number(params.id));
                setBillingCycles(cyclesData);

                // Set default billing cycle (find the default one or use the first one)
                const defaultCycle = cyclesData.find(c => c.isDefault) || cyclesData[0];
                if (defaultCycle) {
                    setSelectedBillingDays(defaultCycle.days);
                }

                // Initialize selected egg with the default (first allowed egg)
                const allowedEggs = productData.allowedEggs || [productData.eggId];

                const eggResults = await Promise.allSettled(allowedEggs.map(id => getEggInfo(id)));
                const available: EggInfo[] = [];
                let removedMissingEggs = false;

                eggResults.forEach(result => {
                    if (result.status === 'fulfilled') {
                        available.push(result.value);
                        return;
                    }

                    const responseStatus = getResponseStatus(result.reason);

                    if (responseStatus === 404) {
                        removedMissingEggs = true;
                        return;
                    }

                    // Attach the original error as the cause for debugging.
                    const message = responseStatus
                        ? `Failed to fetch server software details (HTTP ${responseStatus}).`
                        : 'Unexpected error while fetching server software details.';
                    throw new Error(message, { cause: result.reason });
                });

                if (removedMissingEggs) {
                    addFlash({
                        key: 'account:billing:order',
                        type: 'warning',
                        message:
                            'Some server software options are no longer available and were removed from selection.',
                    });
                }

                setAvailableEggs(available);
                if (available.length > 0) {
                    setSelectedEggId(available[0]!.id);
                } else {
                    // Clear selections and variables when no eggs remain.
                    setSelectedEggId(undefined);
                    setEggs(undefined);
                }

                // Fetch nodes
                const nodesData = await getViableNodes(productData.id);
                setNodes(nodesData);
                const firstNodeId = Number(nodesData.at(0)?.id ?? 0);
                setSelectedNode(Number.isInteger(firstNodeId) && firstNodeId > 0 ? firstNodeId : 0);
                setSelectedNode(Number(nodesData[0]?.id) ?? 0);

                const domainsData = await getAvailableCustomDomains(allowedEggs[0]);
                setCustomDomainOptions(domainsData);
                const firstDomain = domainsData[0];
                if (firstDomain) {
                    setSelectedDomainId(firstDomain.id);
                    setMappingRecordType(firstDomain.recommended_record_type);
                }
            } catch (error: unknown) {
                console.error('Error fetching billing order data:', error);
                if (error instanceof Error && error.message) {
                    addFlash({ key: 'account:billing:order', type: 'error', message: error.message });
                    return;
                }
                clearAndAddHttpError({ key: 'account:billing:order', error });
            }
        };

        fetchData();
    }, [params.id]);

    useEffect(() => {
        clearFlashes();

        if (!product || eggs || !selectedEggId) return;

        // Fetch product variables (egg data) for the selected egg
        getProductVariables(selectedEggId)
            .then(data => setEggs(data))
            .catch(error => console.error(error));
    }, [product, selectedEggId]);

    useEffect(() => {
        if (!selectedEggId) {
            return;
        }

        getAvailableCustomDomains(selectedEggId)
            .then(domains => {
                setCustomDomainOptions(domains);

                const currentlySelected = domains.find(option => option.id === selectedDomainId);
                const nextSelected = currentlySelected ?? domains[0];

                if (nextSelected) {
                    if (!currentlySelected) {
                        setSelectedDomainId(nextSelected.id);
                    }

                    setMappingRecordType(nextSelected.recommended_record_type);
                } else {
                    setSelectedDomainId(0);
                }
            })
            .catch(error => console.error(error));
    }, [selectedEggId]);

    // Auto-generate server name when selections change
    useEffect(() => {
        if (!serverNameTouched && product && selectedNode && selectedEggId) {
            const generatedName = generateServerName();
            if (generatedName) {
                setServerName(generatedName);
            }
        }
    }, [selectedNode, selectedEggId, product, serverNameTouched, generateServerName]);

    // Clear coupon when billing cycle changes to prevent showing incorrect totals
    useEffect(() => {
        if (couponData) {
            // Clear the coupon data to force revalidation with new price
            setCouponData(null);
        }
        // Note: couponData is intentionally NOT in the dependency array to avoid infinite loops
        // We only want to clear it when selectedBillingDays changes
    }, [selectedBillingDays]);

    if (!product) return <Spinner centered />;

    const sectionContainerClass =
        'space-y-6 rounded-2xl border border-gray-800 p-6 shadow-lg shadow-black/15 transition-colors';
    const sectionHeaderClass = 'space-y-1.5';
    const sectionContainerStyle = {
        backgroundColor: colors.background,
        borderColor: '#1f2937',
    };
    const cardSurfaceStyle = { backgroundColor: colors.secondary, borderColor: '#374151' };

    return (
        <PageContentBlock title={'Configure Checkout'}>
            <FlashMessageRender byKey={'account:billing:order'} className={'mb-4'} />

            <div className={'mb-8'}>
                <h1 className={'text-4xl font-bold text-gray-100'}>Configure Your Server</h1>
                <p className={'mt-2 text-base text-gray-400'}>
                    Choose your node, software, configuration, and review everything on a single page before payment.
                </p>
            </div>

            <div className={'grid gap-8 lg:grid-cols-12'}>
                <div className={'space-y-12 lg:col-span-8'}>
                    <section id={'pricing'} className={`${sectionContainerClass}`} style={sectionContainerStyle}>
                        <div className={sectionHeaderClass}>
                            <p className={'text-xs uppercase tracking-[0.25em] text-gray-400'}>Section 1</p>
                            <h2 className={'text-3xl font-bold text-gray-100 leading-tight'}>Node Selection</h2>
                            <p className={'text-sm text-gray-400 md:text-base'}>
                                Select the node where your server will run and choose your billing cycle.
                            </p>
                        </div>
                        {(!nodes || nodes.length < 1) && (
                            <Alert type={'danger'}>
                                No nodes are available for this product. Please contact support.
                            </Alert>
                        )}
                        <div className={'grid gap-4 sm:grid-cols-2'}>
                            {nodes?.map(node => (
                                <NodeBox
                                    node={node}
                                    key={node.id}
                                    selected={selectedNode}
                                    setSelected={setSelectedNode}
                                    basePrice={getCurrentPrice()}
                                    billingDays={selectedBillingDays}
                                />
                            ))}
                        </div>
                        <div className={'space-y-3'}>
                            <h3 className={'text-lg font-semibold text-gray-200'}>Billing Cycle</h3>
                            {billingCycles.map(cycle => (
                                <BillingCycleBox
                                    cycle={cycle}
                                    key={cycle.days}
                                    selected={selectedBillingDays}
                                    setSelected={setSelectedBillingDays}
                                />
                            ))}
                        </div>
                    </section>

                    <section id={'software'} className={`${sectionContainerClass}`} style={sectionContainerStyle}>
                        <div className={sectionHeaderClass}>
                            <p className={'text-xs uppercase tracking-[0.25em] text-gray-400'}>Section 2</p>
                            <h2 className={'text-3xl font-bold text-gray-100 leading-tight'}>Software</h2>
                            <p className={'text-sm text-gray-400 md:text-base'}>
                                Pick the server software or modpack you want to run.
                            </p>
                        </div>
                        {availableEggs.length === 0 ? (
                            <Alert type={'warning'}>
                                No server software options are currently available for this product. This may be due to
                                configuration changes. Please contact support for assistance.
                            </Alert>
                        ) : (
                            <div className={'grid gap-4 sm:grid-cols-2'}>
                                {availableEggs.map(egg => (
                                    <EggBox
                                        egg={egg}
                                        key={egg.id}
                                        selected={selectedEggId}
                                        setSelected={setSelectedEggId}
                                        onEggChange={() => setEggs(undefined)}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <section id={'configuration'} className={`${sectionContainerClass}`} style={sectionContainerStyle}>
                        <div className={sectionHeaderClass}>
                            <p className={'text-xs uppercase tracking-[0.25em] text-gray-400'}>Section 3</p>
                            <h2 className={'text-3xl font-bold text-gray-100 leading-tight'}>Configuration</h2>
                            <p className={'text-sm text-gray-400 md:text-base'}>
                                Name your server and set any required configuration values for your selected software.
                            </p>
                        </div>
                        <div className={'rounded-lg border p-6'} style={cardSurfaceStyle}>
                            <h3 className={'mb-4 text-lg font-semibold text-gray-200'}>Server Name</h3>
                            <input
                                id={'server-name-input'}
                                type={'text'}
                                placeholder={'Enter a name for your server'}
                                value={serverName}
                                onChange={e => {
                                    setServerName(e.target.value);
                                    setServerNameTouched(true);
                                }}
                                required
                                maxLength={191}
                                aria-invalid={serverNameTouched && !serverName.trim()}
                                aria-describedby={
                                    serverNameTouched && !serverName.trim() ? 'server-name-error' : undefined
                                }
                                className={classNames(
                                    'w-full rounded-lg border-2 px-4 py-3 text-sm transition-all',
                                    'text-gray-200 placeholder-gray-500',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/20',
                                    {
                                        'border-gray-600': !serverNameTouched,
                                        'border-green-500 focus:border-green-500':
                                            serverNameTouched && serverName.trim(),
                                        'border-red-500 focus:border-red-500': serverNameTouched && !serverName.trim(),
                                    },
                                )}
                                style={{
                                    backgroundColor: colors.secondary,
                                }}
                            />
                            {serverNameTouched && !serverName.trim() && (
                                <p id={'server-name-error'} className={'mt-2 text-xs text-red-400'} role={'alert'}>
                                    Server name is required to continue
                                </p>
                            )}
                        </div>
                        {hasEditableVariables && (
                            <div className={'space-y-3'}>
                                <h3 className={'text-lg font-semibold text-gray-200'}>Variables</h3>
                                <div className={'grid gap-4 sm:grid-cols-2'}>
                                    {eggs?.map(variable => (
                                        <div key={variable.envVariable}>
                                            {variable.isEditable && <VariableBox variable={variable} vars={vars} />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>

                    <section id={'review'} className={`${sectionContainerClass}`} style={sectionContainerStyle}>
                        <div className={sectionHeaderClass}>
                            <p className={'text-xs uppercase tracking-[0.25em] text-gray-400'}>Section 4</p>
                            <h2 className={'text-3xl font-bold text-gray-100 leading-tight'}>Review</h2>
                            <p className={'text-sm text-gray-400 md:text-base'}>
                                Confirm your selections before continuing to payment.
                            </p>
                        </div>

                        <div className={'rounded-lg border p-6 space-y-6'} style={cardSurfaceStyle}>
                            <div className={'space-y-3'}>
                                <div className={'flex items-center gap-3 pb-3 border-b border-gray-700'}>
                                    {product.icon && (
                                        <img src={product.icon} className={'h-10 w-10 rounded'} alt={product.name} />
                                    )}
                                    <div>
                                        <p className={'font-semibold text-gray-200'}>{product.name}</p>
                                        <p className={'text-sm text-gray-400'}>
                                            {selectedBillingDays} {selectedBillingDays === 1 ? 'day' : 'days'} billing
                                            cycle
                                        </p>
                                    </div>
                                </div>
                                <div className={'grid grid-cols-2 gap-4'}>
                                    <div>
                                        <p className={'text-xs uppercase text-gray-500'}>Location</p>
                                        <p className={'text-sm font-semibold text-gray-200'}>
                                            {nodes?.find(n => Number(n.id) === selectedNode)?.name || 'Not selected'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className={'text-xs uppercase text-gray-500'}>Server Type</p>
                                        <p className={'text-sm font-semibold text-gray-200'}>
                                            {availableEggs.find(e => e.id === selectedEggId)?.name || 'Not selected'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className={'text-xs uppercase text-gray-500'}>Server Name</p>
                                        <p className={'text-sm font-semibold text-gray-200'}>
                                            {serverName.trim() || 'Not set'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className={'text-xs uppercase text-gray-500'}>Cycle</p>
                                        <p className={'text-sm font-semibold text-gray-200'}>
                                            {billingCycles.find(c => c.days === selectedBillingDays)?.label ??
                                                `${selectedBillingDays} days`}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div
                                className={'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all'}
                                style={
                                    legalAgreed
                                        ? { borderColor: colors.primary, backgroundColor: `${colors.primary}15` }
                                        : { borderColor: '#374151', backgroundColor: colors.secondary }
                                }
                                onClick={() => setLegalAgreed(prev => !prev)}
                            >
                                <AdminCheckbox
                                    name={'legal'}
                                    checked={legalAgreed}
                                    onChange={e => {
                                        e.stopPropagation();
                                        setLegalAgreed(e.currentTarget.checked);
                                    }}
                                />
                                <div className={'min-w-0 flex-1'}>
                                    <p className={'text-sm font-medium text-gray-200'}>
                                        I agree to the{' '}
                                        <a
                                            href={billing.links.terms}
                                            target={'_blank'}
                                            rel={'noreferrer'}
                                            className={'hover:brightness-125'}
                                            style={{ color: colors.primary }}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            Terms of Service
                                            <FontAwesomeIcon icon={faExternalLinkAlt} className={'ml-1 text-xs'} />
                                        </a>
                                        {' and '}
                                        <a
                                            href={billing.links.privacy}
                                            target={'_blank'}
                                            rel={'noreferrer'}
                                            className={'hover:brightness-125'}
                                            style={{ color: colors.primary }}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            Privacy Policy
                                            <FontAwesomeIcon icon={faExternalLinkAlt} className={'ml-1 text-xs'} />
                                        </a>
                                    </p>
                                    {legalAgreed && (
                                        <p className={'mt-1 text-xs'} style={{ color: colors.primary }}>
                                            ✓ Accepted
                                        </p>
                                    )}
                                </div>
                            </div>

                            {totalIsFree ? (
                                <Button
                                    onClick={() => void createFree()}
                                    size={Button.Sizes.Large}
                                    className={'w-full'}
                                    disabled={!reviewReady || checkingBillingAddress}
                                >
                                    {checkingBillingAddress ? 'Verifying Billing Address...' : 'Create Server'}
                                </Button>
                            ) : (
                                <Button
                                    onClick={async () => {
                                        setServerNameTouched(true);
                                        if (!reviewReady) return;

                                        const canContinue = await assertBillingAddressBeforeCheckout();
                                        if (!canContinue) {
                                            return;
                                        }

                                        const checkoutPayload = {
                                            productId: product.id,
                                            selectedNode,
                                            selectedBillingDays,
                                            selectedEggId,
                                            vars: Array.from(vars.entries()),
                                            couponId: couponData?.coupon.id,
                                            couponData,
                                            serverName: serverName.trim(),
                                        };
                                        // Persist to sessionStorage so step 2 survives a page refresh
                                        setDraft(checkoutPayload);
                                        navigate('/checkout/payment', {
                                            state: checkoutPayload,
                                        });
                                    }}
                                    size={Button.Sizes.Large}
                                    className={'w-full'}
                                    disabled={!reviewReady || checkingBillingAddress}
                                >
                                    {checkingBillingAddress ? 'Verifying Billing Address...' : 'Continue to Payment →'}
                                </Button>
                            )}
                        </div>
                    </section>
                </div>

                <div className={'lg:col-span-4'}>
                    <div className={'sticky top-24'}>
                        <SubtotalCard
                            basePrice={product.price}
                            selectedNode={selectedNode}
                            nodes={nodes}
                            selectedEggId={selectedEggId}
                            availableEggs={availableEggs}
                            selectedBillingDays={selectedBillingDays}
                            billingCycles={billingCycles}
                            couponDiscount={couponData?.discount || 0}
                            couponCode={couponData?.coupon.code}
                            productName={product.name}
                            showDetailedBreakdown={true}
                            showCouponInput={true}
                            onCouponApplied={handleCouponApplied}
                        />
                    </div>
                </div>
            </div>
        </PageContentBlock>
    );
};
