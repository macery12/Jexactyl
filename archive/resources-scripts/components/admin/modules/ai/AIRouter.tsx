import { useStoreState } from '@/state/hooks';
import { Route, Routes } from 'react-router-dom';
import { CogIcon, SparklesIcon } from '@heroicons/react/outline';
import { useEffect, useState } from 'react';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { NotFound } from '@/elements/ScreenBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import EnableAI from '@admin/modules/ai/EnableAI';
import OverviewContainer from '@admin/modules/ai/OverviewContainer';
import ConfigureAI from '@admin/modules/ai/ConfigureAI';
import SettingsContainer from './SettingsContainer';
import Spinner from '@/elements/Spinner';
import { fetchSettings, updateSettings, type AIAdminSettings } from '@/api/routes/admin/ai/settings';

export default () => {
    const settings = useStoreState(state => state.everest.data!.ai);
    const [adminAiSettings, setAdminAiSettings] = useState<AIAdminSettings | null>(null);
    const [loadingAdminSettings, setLoadingAdminSettings] = useState(false);

    useEffect(() => {
        if (!settings.enabled) return;

        setLoadingAdminSettings(true);
        fetchSettings()
            .then(setAdminAiSettings)
            .catch(() => setAdminAiSettings(null))
            .finally(() => setLoadingAdminSettings(false));
    }, [settings.enabled]);

    if (!settings.enabled) return <EnableAI />;

    // For Ollama mode, key is not required, only check for endpoint and model.
    // For OpenAI mode, key is required.
    const needsConfiguration = adminAiSettings
        ? adminAiSettings.mode === 'ollama'
            ? !adminAiSettings.endpoint || !adminAiSettings.model
            : !adminAiSettings.key || !adminAiSettings.endpoint || !adminAiSettings.model
        : true;

    const handleDismissConfiguration = () => {
        // Disable AI when user dismisses configuration dialog
        updateSettings({ enabled: false })
            .catch(error => {
                console.error('Failed to disable AI:', error);
            })
            .finally(() => {
                // Reload page to refresh everest state and return to EnableAI screen
                // @ts-expect-error this is fine
                window.location = '/admin/ai';
            });
    };

    if (settings.enabled && loadingAdminSettings) {
        return (
            <AdminContentBlock title={'M12Labs-AI'}>
                <div className={'flex w-full justify-center py-10'}>
                    <Spinner size={'large'} />
                </div>
            </AdminContentBlock>
        );
    }

    if (settings.enabled && needsConfiguration) return <ConfigureAI onDismiss={handleDismissConfiguration} />;

    return (
        <AdminContentBlock title={'M12Labs-AI'}>
            <FlashMessageRender byKey={'admin:ai'} className={'mb-4'} />
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>M12Labs-AI</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Use Artificial Intelligence to add more power to your panel.
                    </p>
                </div>
            </div>
            <SubNavigation>
                <SubNavigationLink to={'/admin/ai'} name={'General'} base>
                    <SparklesIcon />
                </SubNavigationLink>
                <SubNavigationLink to={'/admin/ai/settings'} name={'Options'}>
                    <CogIcon />
                </SubNavigationLink>
            </SubNavigation>
            <Routes>
                <Route path={'/'} element={<OverviewContainer />} />
                <Route path={'/settings'} element={<SettingsContainer />} />

                <Route path={'/*'} element={<NotFound />} />
            </Routes>
        </AdminContentBlock>
    );
};
