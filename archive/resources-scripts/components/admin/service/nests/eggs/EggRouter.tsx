import { useEffect } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import tw from 'twin.macro';

import { useEggFromRoute } from '@/api/routes/admin/egg';
import EggInstallContainer from '@admin/service/nests/eggs/EggInstallContainer';
import EggVariablesContainer from '@admin/service/nests/eggs/EggVariablesContainer';
import useFlash from '@/plugins/useFlash';
import AdminContentBlock from '@/elements/AdminContentBlock';
import Spinner from '@/elements/Spinner';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import EggSettingsContainer, {
    EggAdvancedContainer,
    EggDockerContainer,
} from '@admin/service/nests/eggs/EggSettingsContainer';

const EggRouter = () => {
    const { id, nestId } = useParams<'nestId' | 'id'>();

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { data: egg, error, isValidating, mutate } = useEggFromRoute();

    useEffect(() => {
        void mutate();
    }, []);

    useEffect(() => {
        if (!error) clearFlashes('egg');
        if (error) clearAndAddHttpError({ key: 'egg', error });
    }, [error]);

    if (!egg || (error && isValidating)) {
        return (
            <AdminContentBlock showFlashKey={'egg'}>
                <Spinner size={'large'} centered />
            </AdminContentBlock>
        );
    }

    return (
        <AdminContentBlock title={'Egg - ' + egg.name}>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-4`}>
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>{egg.name}</h2>
                    <p
                        css={tw`hidden md:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        {egg.uuid}
                    </p>
                </div>
            </div>

            <FlashMessageRender byKey={'egg'} css={tw`mb-4`} />

            <SubNavigation>
                <SubNavigationLink to={`/admin/nests/${nestId ?? ''}/eggs/${id ?? ''}`} name={'About'} base>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            clipRule="evenodd"
                            fillRule="evenodd"
                            d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z"
                        />
                    </svg>
                </SubNavigationLink>

                <SubNavigationLink to={`/admin/nests/${nestId ?? ''}/eggs/${id ?? ''}/docker`} name={'Docker'}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M6 6h8v3H6V6zM4 11h12v5H4v-5zm-1-1h14V4H3v6z" />
                    </svg>
                </SubNavigationLink>

                <SubNavigationLink to={`/admin/nests/${nestId ?? ''}/eggs/${id ?? ''}/variables`} name={'Variables'}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
                    </svg>
                </SubNavigationLink>

                <SubNavigationLink to={`/admin/nests/${nestId ?? ''}/eggs/${id ?? ''}/install`} name={'Install Script'}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            clipRule="evenodd"
                            fillRule="evenodd"
                            d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z"
                        />
                    </svg>
                </SubNavigationLink>

                <SubNavigationLink to={`/admin/nests/${nestId ?? ''}/eggs/${id ?? ''}/advanced`} name={'Advanced'}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            clipRule="evenodd"
                            fillRule="evenodd"
                            d="M11.3 1.046a1 1 0 00-2.6 0l-.253.76a1 1 0 01-.95.69H6.7a1 1 0 00-.81.41l-.447.63a1 1 0 01-1.11.37l-.74-.25a1 1 0 00-1.3 1.3l.25.74a1 1 0 01-.37 1.11l-.63.447a1 1 0 00-.41.81v.797a1 1 0 01-.69.95l-.76.253a1 1 0 000 2.6l.76.253a1 1 0 01.69.95v.797a1 1 0 00.41.81l.63.447a1 1 0 01.37 1.11l-.25.74a1 1 0 001.3 1.3l.74-.25a1 1 0 011.11.37l.447.63a1 1 0 00.81.41h.797a1 1 0 01.95.69l.253.76a1 1 0 002.6 0l.253-.76a1 1 0 01.95-.69h.797a1 1 0 00.81-.41l.447-.63a1 1 0 011.11-.37l.74.25a1 1 0 001.3-1.3l-.25-.74a1 1 0 01.37-1.11l.63-.447a1 1 0 00.41-.81v-.797a1 1 0 01.69-.95l.76-.253a1 1 0 000-2.6l-.76-.253a1 1 0 01-.69-.95v-.797a1 1 0 00-.41-.81l-.63-.447a1 1 0 01-.37-1.11l.25-.74a1 1 0 00-1.3-1.3l-.74.25a1 1 0 01-1.11-.37l-.447-.63a1 1 0 00-.81-.41h-.797a1 1 0 01-.95-.69l-.253-.76zM10 13a3 3 0 100-6 3 3 0 000 6z"
                        />
                    </svg>
                </SubNavigationLink>
            </SubNavigation>

            <Routes>
                <Route path="" element={<EggSettingsContainer />} />
                <Route path="docker" element={<EggDockerContainer />} />
                <Route path="variables" element={<EggVariablesContainer />} />
                <Route path="install" element={<EggInstallContainer />} />
                <Route path="advanced" element={<EggAdvancedContainer />} />
            </Routes>
        </AdminContentBlock>
    );
};

export default () => {
    return <EggRouter />;
};
