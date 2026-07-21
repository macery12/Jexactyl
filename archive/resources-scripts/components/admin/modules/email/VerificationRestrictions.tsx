import { useEffect, useMemo, useState } from 'react';
import { getVerificationRules, updateVerificationRules } from '@/api/routes/admin/email';
import {
    DEFAULT_EMAIL_VERIFICATION_RULES,
    EMAIL_VERIFICATION_ALERT_MESSAGE,
    EMAIL_VERIFICATION_AREA_LABELS,
    normalizeVerificationRules,
} from '@/constants/emailVerification';
import { type VerificationArea, type VerificationRules } from '@/state/everest';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';

const areas: VerificationArea[] = ['billing', 'orders', 'credentials', 'tickets'];

const cloneRules = (rules: VerificationRules) => JSON.parse(JSON.stringify(rules)) as VerificationRules;

const VerificationRestrictions = () => {
    const { clearAndAddHttpError, clearFlashes, addFlash } = useFlash();
    const { background } = useStoreState(state => state.theme.data!.colors);
    const [rules, setRules] = useState<VerificationRules>(() => cloneRules(DEFAULT_EMAIL_VERIFICATION_RULES));
    const [initialRules, setInitialRules] = useState<VerificationRules>(() =>
        cloneRules(DEFAULT_EMAIL_VERIFICATION_RULES),
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const hasChanges = useMemo(() => {
        return (
            JSON.stringify(normalizeVerificationRules(initialRules)) !==
            JSON.stringify(normalizeVerificationRules(rules))
        );
    }, [initialRules, rules]);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            clearFlashes('email:verification');

            try {
                const data = await getVerificationRules();
                const normalized = normalizeVerificationRules(data);
                setRules(normalized);
                setInitialRules(normalized);
            } catch (error) {
                clearAndAddHttpError({ key: 'email:verification', error });
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, []);

    const updateRule = (area: VerificationArea, key: keyof VerificationRules[VerificationArea]) => {
        setRules(current => {
            const next = cloneRules(current);
            next[area][key] = !current[area][key];
            return next;
        });
    };

    const handleReset = () => {
        setRules(cloneRules(DEFAULT_EMAIL_VERIFICATION_RULES));
    };

    const handleSave = async () => {
        setSaving(true);
        clearFlashes('email:verification');

        try {
            const normalized = normalizeVerificationRules(rules);
            const saved = await updateVerificationRules(normalized);
            const normalizedSaved = normalizeVerificationRules(saved);
            setRules(normalizedSaved);
            setInitialRules(normalizedSaved);

            addFlash({
                key: 'email:verification',
                type: 'success',
                message: 'Verification restrictions saved successfully.',
            });
        } catch (error) {
            clearAndAddHttpError({ key: 'email:verification', error });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Spinner size="large" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-amber-600/60 bg-amber-900/30 p-4 text-sm text-amber-100">
                <p className="font-semibold">Backend enforcement is enabled.</p>
                <p className="mt-1 text-amber-50">
                    {EMAIL_VERIFICATION_ALERT_MESSAGE} Client-side changes cannot bypass these rules.
                </p>
            </div>

            <div className="flex flex-wrap gap-3">
                <Button onClick={handleSave} disabled={!hasChanges || saving} loading={saving}>
                    Save changes
                </Button>
                <Button.Text onClick={handleReset} disabled={saving}>
                    Reset to defaults
                </Button.Text>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {areas.map(area => (
                    <div
                        key={area}
                        className="space-y-3 rounded-lg border border-neutral-700 p-4"
                        style={{ backgroundColor: background }}
                    >
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-neutral-100">
                                    {EMAIL_VERIFICATION_AREA_LABELS[area]}
                                </h3>
                                <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs uppercase tracking-wide text-neutral-300">
                                    {area}
                                </span>
                            </div>
                            <p className="text-sm text-neutral-300">
                                Control whether unverified users can view this area or perform protected actions.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label
                                className="flex items-center gap-3 text-sm text-neutral-100 rounded-md border border-neutral-700 px-3 py-2 hover:border-neutral-500 transition-colors cursor-pointer"
                                style={{ backgroundColor: background }}
                            >
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 rounded border-2 border-neutral-500 bg-neutral-900 text-green-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                                    checked={rules[area].can_view}
                                    onChange={() => updateRule(area, 'can_view')}
                                />
                                <span>Allow unverified users to view</span>
                            </label>

                            <label
                                className="flex items-center gap-3 text-sm text-neutral-100 rounded-md border border-neutral-700 px-3 py-2 hover:border-neutral-500 transition-colors cursor-pointer"
                                style={{ backgroundColor: background }}
                            >
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 rounded border-2 border-neutral-500 bg-neutral-900 text-green-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                                    checked={rules[area].can_interact}
                                    onChange={() => updateRule(area, 'can_interact')}
                                />
                                <span>Allow unverified users to interact</span>
                            </label>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VerificationRestrictions;
