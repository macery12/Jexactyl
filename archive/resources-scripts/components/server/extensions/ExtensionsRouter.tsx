import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/elements/ScreenBlock';
import ExtensionsContainer from './ExtensionsContainer';
import Spinner from '@/elements/Spinner';
import { extensionRoutes } from './registry';

export default () => {
    return (
        <Routes>
            <Route index element={<ExtensionsContainer />} />
            {extensionRoutes.map(({ id, route, component: ExtensionComponent }) => (
                <Route
                    key={id}
                    path={route}
                    element={
                        <Suspense
                            fallback={
                                <div className={'flex items-center justify-center py-16'}>
                                    <Spinner size={'large'} />
                                </div>
                            }
                        >
                            <ExtensionComponent />
                        </Suspense>
                    }
                />
            ))}
            <Route path={'*'} element={<NotFound />} />
        </Routes>
    );
};
