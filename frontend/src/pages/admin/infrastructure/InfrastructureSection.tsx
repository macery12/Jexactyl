import { Routes, Route } from 'react-router-dom';
import NodeDetailPage from '@/pages/admin/nodes/NodeDetailPage';
import InfrastructureOverviewPage from './InfrastructureOverviewPage';
import ServerDetailPage from './server/ServerDetailPage';

// Mounted at the admin `infrastructure/*` splat route. Owns the merged
// nodes-and-servers overview plus both detail cockpits, so the registry keeps a
// single flat entry and the sidebar highlights "Infrastructure" throughout.
export default function InfrastructureSection() {
    return (
        <Routes>
            <Route index element={<InfrastructureOverviewPage />} />
            <Route path="nodes/:id" element={<NodeDetailPage />} />
            <Route path="servers/:id" element={<ServerDetailPage />} />
        </Routes>
    );
}
