import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/elements/ScreenBlock';
import AdminContentBlock from '@/elements/AdminContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import { useStoreState } from '@/state/hooks';
import { CogIcon, GlobeAltIcon } from '@heroicons/react/outline';
import DomainsContainer from './domains/DomainsContainer';
import SettingsContainer from './settings/SettingsContainer';
import EnableCustomDomains from './EnableCustomDomains';
import ToggleCustomDomainsButton from './ToggleCustomDomainsButton';

export default () => {
    const enabled = useStoreState(state => state.everest.data!.custom_domains.enabled);

    if (!enabled) return <EnableCustomDomains />;

    return (
        <AdminContentBlock title={'Custom Domains'}>
            <div className={'mb-8 flex w-full flex-row items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Custom Domains</h2>
                    <p className={'overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400'}>
                        Manage domain inventory and Cloudflare credentials for automated DNS provisioning.
                    </p>
                </div>
                <div className={'ml-auto'}>
                    <ToggleCustomDomainsButton />
                </div>
            </div>

            <SubNavigation>
                <SubNavigationLink to={'/admin/custom-domains'} name={'Domains'} base>
                    <GlobeAltIcon />
                </SubNavigationLink>
                <SubNavigationLink to={'/admin/custom-domains/settings'} name={'Settings'}>
                    <CogIcon />
                </SubNavigationLink>
            </SubNavigation>

            <FlashMessageRender byKey={'admin:custom-domains'} className={'mb-4'} />

            <Routes>
                <Route path={'/'} element={<DomainsContainer />} />
                <Route path={'/settings'} element={<SettingsContainer />} />
                <Route path={'/*'} element={<NotFound />} />
            </Routes>
        </AdminContentBlock>
    );
};
