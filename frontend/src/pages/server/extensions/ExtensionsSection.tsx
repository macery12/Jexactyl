import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useServer } from '@/components/server/ServerContext';
import ExtensionsGallery from './ExtensionsGallery';
import { extensionRoutes } from './registry';

// Mounted at the server `extensions/*` splat. The index is the gallery of
// extensions enabled for this server; each installed package contributes its
// own route from the glob registry and is code-split behind Suspense.
export default function ExtensionsSection() {
    const server = useServer();

    return (
        <Routes>
            <Route index element={<ExtensionsGallery />} />
            {extensionRoutes.map(({ id, route, component: ExtensionPage }) => (
                <Route
                    key={id}
                    path={route}
                    element={
                        <Suspense
                            fallback={
                                <div className="flex justify-center py-16">
                                    <Spinner className="h-7 w-7" />
                                </div>
                            }
                        >
                            <ExtensionPage />
                        </Suspense>
                    }
                />
            ))}
            {/* An extension that was uninstalled or disabled leaves stale links behind. */}
            <Route path="*" element={<Navigate to={`/server/${server.id}/extensions`} replace />} />
        </Routes>
    );
}
