import { Routes, Route } from 'react-router-dom';
import RolesListPage from './RolesListPage';
import RoleDetailPage from './RoleDetailPage';

// Mounted at the admin `roles/*` splat route. The list owns creation (modal) and
// deletion (confirm); each role's metadata + permission matrix live on the
// dedicated `:id` detail page.
export default function RolesSection() {
    return (
        <Routes>
            <Route index element={<RolesListPage />} />
            <Route path=":id" element={<RoleDetailPage />} />
        </Routes>
    );
}
