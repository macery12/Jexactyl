import { useFlags } from '@/state/flags';

// Live-patch the everest billing config in the flags store after a settings
// write, so dependent UI (currency symbol, processor toggles) updates without a
// reload — mirrors V1's updateEverest({ billing }).
export function patchBilling(patch: Record<string, unknown>) {
    useFlags.setState(s => {
        if (!s.everest) return {};
        return {
            everest: {
                ...s.everest,
                billing: { ...s.everest.billing, ...patch },
            },
        };
    });
}
