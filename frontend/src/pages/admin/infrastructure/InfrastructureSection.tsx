import { Routes, Route } from 'react-router-dom';
import NodeDetailPage from '@/pages/admin/nodes/NodeDetailPage';
import InfrastructureOverviewPage from './InfrastructureOverviewPage';
import ServerDetailPage from './server/ServerDetailPage';
import ServerEditorPage from './ServerEditorPage';
import NodeEditorPage from './NodeEditorPage';

// Mounted at the admin `infrastructure/*` splat route. Owns the merged
// nodes-and-servers overview plus both detail cockpits, so the registry keeps a
// single flat entry and the sidebar highlights "Infrastructure" throughout.
export default function InfrastructureSection() {
    return (
        <Routes>
            <Route index element={<InfrastructureOverviewPage />} />
            {/* Literal `new` must precede the `:id` params or it gets swallowed. */}
            <Route path="nodes/new" element={<NodeEditorPage />} />
            <Route path="nodes/:id/edit" element={<NodeEditorPage />} />
            <Route path="nodes/:id" element={<NodeDetailPage />} />
            <Route path="servers/new" element={<ServerEditorPage />} />
            <Route path="servers/:id" element={<ServerDetailPage />} />
        </Routes>
    );
}
