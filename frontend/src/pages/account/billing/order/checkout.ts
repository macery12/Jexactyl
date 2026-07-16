import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
    getStoreProduct,
    getProductBillingCycles,
    getViableNodes,
    getEggInfo,
    getProductVariables,
    validateCoupon,
    type EggInfo,
    type ProductCycle,
    type StoreEggVariable,
    type StoreProduct,
    type ValidateCouponResponse,
    type ViableNode,
} from '@/api/accountBilling';

// Live checkout state for the configure step. Loads the product, billing
// cycles, viable nodes, allowed eggs (filtered to those that still resolve) and
// the selected egg's variables, then exposes selections + derived pricing.
// Selections initialise directly from loaded data (no effect races) — the same
// load-then-init pattern the admin category form uses.

export interface CheckoutController {
    isLoading: boolean;
    isError: boolean;
    error: unknown;

    product?: StoreProduct;
    cycles: ProductCycle[];
    nodes: ViableNode[];
    eggs: EggInfo[];
    variables: StoreEggVariable[];
    variablesLoading: boolean;

    nodeId: number;
    setNodeId: (id: number) => void;
    cycleDays: number;
    setCycleDays: (days: number) => void;
    eggId: number | undefined;
    setEggId: (id: number) => void;
    vars: Record<string, string>;
    setVar: (env: string, value: string) => void;
    serverName: string;
    setServerName: (name: string) => void;
    legalAgreed: boolean;
    setLegalAgreed: (next: boolean) => void;

    couponData: ValidateCouponResponse | null;
    couponBusy: boolean;
    applyCoupon: (code: string) => Promise<{ ok: boolean; message: string }>;
    clearCoupon: () => void;

    basePrice: number;
    total: number;
    isFree: boolean;
    selectedCycle?: ProductCycle;
}

export function useCheckoutController(productId: number): CheckoutController {
    const productQ = useQuery({ queryKey: ['store', 'product', productId], queryFn: () => getStoreProduct(productId), enabled: productId > 0 });
    const cyclesQ = useQuery({ queryKey: ['store', 'cycles', productId], queryFn: () => getProductBillingCycles(productId), enabled: productId > 0 });
    const nodesQ = useQuery({ queryKey: ['store', 'nodes', productId], queryFn: () => getViableNodes(productId), enabled: productId > 0 });

    const product = productQ.data;
    const allowedEggIds = product?.allowedEggs ?? [];

    // Resolve each allowed egg; some may have been deleted (404) — drop those.
    const eggQueries = useQueries({
        queries: allowedEggIds.map(id => ({
            queryKey: ['store', 'egg', id],
            queryFn: () => getEggInfo(id),
            enabled: allowedEggIds.length > 0,
            retry: false,
        })),
    });
    const eggs = useMemo(
        () => eggQueries.flatMap(q => (q.data ? [q.data] : [])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [eggQueries.map(q => q.data?.id).join(',')],
    );
    const eggsResolved = eggQueries.length === 0 || eggQueries.every(q => q.isFetched);

    // Selections — initialise from loaded data the first time it lands.
    const [nodeId, setNodeId] = useState(0);
    const [cycleDays, setCycleDays] = useState(0);
    const [eggId, setEggId] = useState<number | undefined>(undefined);
    const [serverName, setServerName] = useState('');
    const [legalAgreed, setLegalAgreed] = useState(false);
    const [varsByEgg, setVarsByEgg] = useState<Record<number, Record<string, string>>>({});
    const [couponData, setCouponData] = useState<ValidateCouponResponse | null>(null);
    const [couponBusy, setCouponBusy] = useState(false);

    // Seed node from first viable node.
    useEffect(() => {
        if (nodeId === 0 && nodesQ.data && nodesQ.data.length > 0) setNodeId(nodesQ.data[0]!.id);
    }, [nodesQ.data, nodeId]);

    // Seed billing cycle from the default (or first) cycle.
    useEffect(() => {
        if (cycleDays === 0 && cyclesQ.data && cyclesQ.data.length > 0) {
            const def = cyclesQ.data.find(c => c.isDefault) ?? cyclesQ.data[0]!;
            setCycleDays(def.days);
        }
    }, [cyclesQ.data, cycleDays]);

    // Seed egg from first resolved allowed egg.
    useEffect(() => {
        if (eggId === undefined && eggs.length > 0) setEggId(eggs[0]!.id);
    }, [eggs, eggId]);

    // Variables for the selected egg (egg id doubles as the variables key here,
    // matching V1's getProductVariables(selectedEggId)).
    const variablesQ = useQuery({
        queryKey: ['store', 'variables', eggId],
        queryFn: () => getProductVariables(eggId as number),
        enabled: typeof eggId === 'number' && eggId > 0,
    });
    const editableVars = useMemo(() => (variablesQ.data ?? []).filter(v => v.isEditable), [variablesQ.data]);

    const vars = useMemo(() => {
        const seeded: Record<string, string> = {};
        for (const v of editableVars) seeded[v.envVariable] = v.defaultValue;
        return { ...seeded, ...(eggId != null ? (varsByEgg[eggId] ?? {}) : {}) };
    }, [editableVars, varsByEgg, eggId]);

    const setVar = (env: string, value: string) =>
        setVarsByEgg(prev => ({ ...prev, [eggId ?? 0]: { ...(prev[eggId ?? 0] ?? {}), [env]: value } }));

    const selectedCycle = cyclesQ.data?.find(c => c.days === cycleDays);
    const basePrice = selectedCycle?.price ?? product?.price ?? 0;
    const total = couponData ? couponData.total : basePrice;
    const isFree = total === 0;

    // Coupon is priced against the current cycle; changing the cycle invalidates it.
    useEffect(() => {
        if (couponData) setCouponData(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cycleDays]);

    const applyCoupon = async (raw: string): Promise<{ ok: boolean; message: string }> => {
        const code = raw.trim();
        if (!code) return { ok: false, message: m['billing.coupon.empty']() };
        setCouponBusy(true);
        try {
            const result = await validateCoupon(code, basePrice, 'new');
            setCouponData(result);
            return { ok: true, message: m['billing.coupon.applied']({ code: result.coupon.code }) };
        } catch {
            return { ok: false, message: m['billing.coupon.invalid']() };
        } finally {
            setCouponBusy(false);
        }
    };
    const clearCoupon = () => setCouponData(null);

    return {
        isLoading: productQ.isLoading || cyclesQ.isLoading || nodesQ.isLoading || !eggsResolved,
        isError: productQ.isError || cyclesQ.isError || nodesQ.isError,
        error: productQ.error ?? cyclesQ.error ?? nodesQ.error,

        product,
        cycles: cyclesQ.data ?? [],
        nodes: nodesQ.data ?? [],
        eggs,
        variables: editableVars,
        variablesLoading: variablesQ.isLoading,

        nodeId,
        setNodeId,
        cycleDays,
        setCycleDays,
        eggId,
        setEggId,
        vars,
        setVar,
        serverName,
        setServerName,
        legalAgreed,
        setLegalAgreed,

        couponData,
        couponBusy,
        applyCoupon,
        clearCoupon,

        basePrice,
        total,
        isFree,
        selectedCycle,
    };
}
