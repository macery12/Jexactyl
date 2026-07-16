import { useStoreState } from '@/state/hooks';
import { Route, Routes, useLocation } from 'react-router-dom';
import { CogIcon, DatabaseIcon, ServerIcon } from '@heroicons/react/outline';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { NotFound } from '@/elements/ScreenBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import EnableMarketplace from '@admin/modules/marketplace/EnableMarketplace';
import OverviewContainer from '@admin/modules/marketplace/OverviewContainer';
import SettingsContainer from './SettingsContainer';
import AccessControlContainer from './AccessControlContainer';

export default () => {
    const settings = useStoreState(state => state.everest.data!.mods);
    const location = useLocation();
    let basePath = '/admin/marketplace';
    if (location.pathname.startsWith('/admin/plugins')) {
        basePath = '/admin/plugins';
    } else if (location.pathname.startsWith('/admin/mods')) {
        basePath = '/admin/mods';
    }

    if (!settings.enabled) return <EnableMarketplace />;

    return (
        <AdminContentBlock title={'Marketplace'}>
            <FlashMessageRender byKey={'admin:marketplace'} className={'mb-4'} />
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Marketplace</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Integrate Modrinth and Spigot for add-ons, mods, and plugins.
                    </p>
                </div>
            </div>
            <SubNavigation>
                <SubNavigationLink to={`${basePath}`} name={'Overview'} base>
                    <DatabaseIcon />
                </SubNavigationLink>
                <SubNavigationLink to={`${basePath}/settings`} name={'Settings'}>
                    <CogIcon />
                </SubNavigationLink>
                <SubNavigationLink to={`${basePath}/access-control`} name={'Access Control'}>
                    <ServerIcon />
                </SubNavigationLink>
            </SubNavigation>
            <Routes>
                <Route path={'/'} element={<OverviewContainer />} />
                <Route path={'/settings'} element={<SettingsContainer />} />
                <Route path={'/access-control'} element={<AccessControlContainer />} />

                <Route path={'/*'} element={<NotFound />} />
            </Routes>
        </AdminContentBlock>
    );
};
