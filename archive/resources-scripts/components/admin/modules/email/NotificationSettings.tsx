import { useEffect, useState } from 'react';
import {
    getNotificationSettings,
    updateNotificationSetting,
    type EmailNotificationSetting,
} from '@/api/routes/admin/email';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import Spinner from '@/elements/Spinner';
import Label from '@/elements/Label';
import { useStoreState } from '@/state/hooks';

export default () => {
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState<Record<string, EmailNotificationSetting[]>>({});
    const [toggling, setToggling] = useState<Record<string, boolean>>({});
    const { clearFlashes, addFlash } = useFlash();
    const { secondary } = useStoreState(state => state.theme.data!.colors);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const data = await getNotificationSettings();
            setCategories(data.categories);
        } catch (error: any) {
            addFlash({
                key: 'email:notifications',
                type: 'error',
                message: error.message || 'Failed to load notification settings',
            });
        } finally {
            setLoading(false);
        }
    };

    const toggleSetting = async (setting: EmailNotificationSetting) => {
        clearFlashes('email:notifications');
        setToggling({ ...toggling, [setting.template_key]: true });

        try {
            await updateNotificationSetting(setting.id, !setting.enabled);

            // Update local state
            const updatedCategories = { ...categories };
            const category = updatedCategories[setting.category]!;
            const index = category.findIndex(s => s.id === setting.id);
            category[index]!.enabled = !setting.enabled;
            setCategories(updatedCategories);

            addFlash({
                key: 'email:notifications',
                type: 'success',
                message: `${setting.name} ${!setting.enabled ? 'enabled' : 'disabled'}`,
            });
        } catch (error: any) {
            addFlash({
                key: 'email:notifications',
                type: 'error',
                message: error.message || 'Failed to update setting',
            });
        } finally {
            setToggling({ ...toggling, [setting.template_key]: false });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Spinner size="large" />
            </div>
        );
    }

    const categoryTitles: Record<string, string> = {
        auth: 'Authentication & Security',
        server: 'Server Notifications',
        billing: 'Billing & Payments',
    };

    return (
        <div className="space-y-6">
            {/* Category Groups */}
            {Object.entries(categories).map(([categoryKey, settings]) => (
                <div key={categoryKey} className="space-y-4">
                    <h3 className="text-lg font-semibold text-neutral-200 border-b border-neutral-700 pb-2">
                        {categoryTitles[categoryKey] || categoryKey}
                    </h3>

                    <div className="space-y-3">
                        {settings.map(setting => {
                            const ItemToggle = setting.enabled ? Button.Success : Button.Danger;

                            return (
                                <div
                                    key={setting.id}
                                    className="flex flex-col gap-3 rounded-lg border border-neutral-700 p-4 sm:flex-row sm:items-center sm:justify-between"
                                    style={{ backgroundColor: secondary }}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Label>{setting.name}</Label>
                                            {setting.rate_limit_exempt && (
                                                <span className="px-2 py-1 text-xs bg-blue-600 text-white rounded">
                                                    Rate Limit Exempt
                                                </span>
                                            )}
                                        </div>
                                        {setting.description && (
                                            <p className="text-sm text-neutral-300 mt-1">{setting.description}</p>
                                        )}
                                        <p className="text-xs text-neutral-400 mt-1 font-mono break-all">
                                            {setting.template_key}
                                        </p>
                                    </div>

                                    <ItemToggle
                                        onClick={() => {
                                            if (!toggling[setting.template_key]) {
                                                toggleSetting(setting);
                                            }
                                        }}
                                        className={`flex-shrink-0 self-start px-4 py-2 sm:ml-4 sm:self-center ${
                                            toggling[setting.template_key] ? 'opacity-50 cursor-not-allowed' : ''
                                        }`}
                                    >
                                        {toggling[setting.template_key] ? (
                                            <Spinner size="small" />
                                        ) : setting.enabled ? (
                                            'Enabled'
                                        ) : (
                                            'Disabled'
                                        )}
                                    </ItemToggle>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {Object.keys(categories).length === 0 && (
                <div className="text-center py-8 text-neutral-400">No email notification types configured</div>
            )}
        </div>
    );
};
