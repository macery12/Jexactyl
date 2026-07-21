import { Routes, Route } from 'react-router-dom';
import UsersListPage from './UsersListPage';

// Mounted at the server `users/*` splat. The list owns create/edit (permission
// matrix modal) and remove (confirm) flows, so there is no dedicated detail route.
export default function UsersSection() {
    return (
        <Routes>
            <Route index element={<UsersListPage />} />
        </Routes>
    );
}
