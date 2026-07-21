import { useEffect } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import tw from 'twin.macro';

import AdminContentBlock from '@/elements/AdminContentBlock';
import Spinner from '@/elements/Spinner';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import useFlash from '@/plugins/useFlash';
import { useServerFromRoute } from '@/api/routes/admin/server';
import {
    ChartBarIcon,
    CogIcon,
    CurrencyDollarIcon,
    DatabaseIcon,
    LightningBoltIcon,
    ExclamationIcon,
    ExternalLinkIcon,
    InformationCircleIcon,
    ServerIcon,
} from '@heroicons/react/outline';
import { useStoreState } from '@/state/hooks';
import ServerDatabases from './ServerDatabases';
import ServerBillingContainer from './billing/ServerBillingContainer';
import ServerOverviewContainer from './ServerOverviewContainer';
import ServerConfigurationContainer from './ServerConfigurationContainer';
import ServerResourcesContainer from './ServerResourcesContainer';
import ServerDangerZoneContainer from './ServerDangerZoneContainer';
import ServerWingsRsContainer from './ServerWingsRsContainer';
import Pill from '@/elements/Pill';

export default () => {
    const params = useParams<'id'>();

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { billing } = useStoreState(state => state.everest.data!);
    const { data: server, error, isValidating, mutate } = useServerFromRoute();

    useEffect(() => {
        mutate();
    }, []);

    useEffect(() => {
        if (!error) clearFlashes('server');
        if (error) clearAndAddHttpError({ key: 'server', error });
    }, [error]);

    if (!server || (error && isValidating)) {
        return (
            <AdminContentBlock showFlashKey={'server'}>
                <Spinner size={'large'} centered />
            </AdminContentBlock>
        );
    }

    return (
        <AdminContentBlock title={'Server - ' + server.name}>
            <FlashMessageRender byKey={'backups'} css={tw`mb-4`} />
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-4`}>
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>{server.name}</h2>
                    <p
                        css={tw`hidden md:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        {server.uuid}
                    </p>
                </div>
                <div className={'my-auto ml-2 flex space-x-2'}>
                    <Pill type={'warn'}>
                        <ServerIcon className={'mr-1 w-3'} /> {server.relationships.allocations[0]?.getDisplayText()}
                    </Pill>
                    {billing.enabled && server.billingProductId && (
                        <Pill type={'info'}>
                            <CurrencyDollarIcon className={'mr-1 w-3'} /> Billable
                        </Pill>
                    )}
                    <Pill type={'success'}>
                        <InformationCircleIcon className={'mr-1 w-3'} /> {server.status ?? 'Active'}
                    </Pill>
                </div>
            </div>

            <FlashMessageRender byKey={'server'} css={tw`mb-4`} />

            <SubNavigation>
                <SubNavigationLink
                    to={`/admin/servers/${params.id}`}
                    name={'Overview'}
                    icon={InformationCircleIcon}
                    base
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/configuration`}
                    name={'Configuration'}
                    icon={CogIcon}
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/resources`}
                    name={'Resources'}
                    icon={ChartBarIcon}
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/databases`}
                    name={'Databases'}
                    icon={DatabaseIcon}
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/billing`}
                    name={'Billing'}
                    icon={CurrencyDollarIcon}
                    disabled={!billing.enabled || !server.billingProductId}
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/danger`}
                    name={'Danger Zone'}
                    icon={ExclamationIcon}
                />
                <SubNavigationLink
                    to={`/admin/servers/${params.id}/wings-rs`}
                    name={'Wings-RS'}
                    icon={LightningBoltIcon}
                />
                <SubNavigationLink
                    to={`/server/${server.uuid.split('-')[0]}`}
                    name={'View as user'}
                    icon={ExternalLinkIcon}
                />
            </SubNavigation>

            <Routes>
                <Route path={''} element={<ServerOverviewContainer />} />
                <Route path={'configuration'} element={<ServerConfigurationContainer />} />
                <Route path={'resources'} element={<ServerResourcesContainer />} />
                <Route path={'databases'} element={<ServerDatabases />} />
                <Route path={'billing'} element={<ServerBillingContainer />} />
                <Route path={'danger'} element={<ServerDangerZoneContainer />} />
                <Route path={'wings-rs'} element={<ServerWingsRsContainer />} />
            </Routes>
        </AdminContentBlock>
    );
};
