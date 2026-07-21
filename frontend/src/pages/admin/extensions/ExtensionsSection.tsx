import { Routes, Route } from 'react-router-dom';
import ExtensionsOverviewPage from './ExtensionsOverviewPage';

// Mounted at the admin `extensions/*` splat route. A single index page today,
// kept as a section so a future per-extension detail route can slot in without
// touching the registry (mirrors InfrastructureSection).
export default function ExtensionsSection() {
    return (
        <Routes>
            <Route index element={<ExtensionsOverviewPage />} />
        </Routes>
    );
}
