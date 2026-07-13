import { Routes, Route } from 'react-router-dom';
import ApiKeysListPage from './ApiKeysListPage';

// Mounted at the admin `api/*` splat route. The list owns the create (modal) and
// delete (confirm) flows, so there is no dedicated detail route.
export default function ApiKeysSection() {
    return (
        <Routes>
            <Route index element={<ApiKeysListPage />} />
        </Routes>
    );
}
