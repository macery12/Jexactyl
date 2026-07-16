import { useEffect } from 'react';
import { useStoreState } from '@/state/hooks';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/elements/ScreenBlock';
import EnableExtensionsContainer from './EnableExtensionsContainer';
import ExtensionsContainer from './ExtensionsContainer';
import ExtensionOperationProgress from './ExtensionOperationProgress';
import RepositoriesContainer from './RepositoriesContainer';
import { PuzzleIcon, CogIcon } from '@heroicons/react/outline';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import FlashMessageRender from '@/elements/FlashMessageRender';
import ToggleExtensionsButton from './ToggleExtensionsButton';

export default () => {
    const enabled = useStoreState(state => state.everest.data?.extensions?.enabled);

    useEffect(() => {
        document.title = 'Admin | M12Labs Extensions';
    }, []);

    if (!enabled) return <EnableExtensionsContainer />;

    return (
        <>
            <FlashMessageRender byKey={'admin:extensions'} className={'mb-4'} />
            <div className={'mb-8 flex w-full flex-row items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>M12Labs Extensions</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Install, configure, and remove panel extensions from trusted repositories.
                    </p>
                </div>
                <div className={'ml-auto'}>
                    <ToggleExtensionsButton />
                </div>
            </div>
            <SubNavigation>
                <SubNavigationLink to={'/admin/extensions'} name={'Catalog'} base>
                    <PuzzleIcon />
                </SubNavigationLink>
                <SubNavigationLink to={'/admin/extensions/repositories'} name={'Repositories'}>
                    <CogIcon />
                </SubNavigationLink>
            </SubNavigation>
            <ExtensionOperationProgress />
            <Routes>
                <Route path={'/'} element={<ExtensionsContainer />} />
                <Route path={'/repositories'} element={<RepositoriesContainer />} />
                <Route path={'/*'} element={<NotFound />} />
            </Routes>
            <p className={'mb-8 mt-4 text-center text-xs text-neutral-500'}>
                Official packages are published through the M12Labs extension repository. Review third-party code before
                installing it into production.
            </p>
        </>
    );
};
