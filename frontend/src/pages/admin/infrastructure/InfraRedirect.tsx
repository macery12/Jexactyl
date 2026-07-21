import { Navigate, useParams } from 'react-router-dom';

// The old admin Nodes/Servers areas were merged into one Infrastructure section.
// These keep deep links alive: `/admin/nodes/:id` → `/admin/infrastructure/nodes/:id`,
// and the bare overviews → the merged overview. Mounted on hidden `nodes/*` /
// `servers/*` registry entries so they redirect without showing in the sidebar.
function redirect(prefix: 'nodes' | 'servers') {
    return function InfraRedirect() {
        const rest = useParams()['*'] ?? '';
        const target = rest
            ? `/admin/infrastructure/${prefix}/${rest}`
            : '/admin/infrastructure';
        return <Navigate to={target} replace />;
    };
}

export const NodesRedirect = redirect('nodes');
export const ServersRedirect = redirect('servers');
