import { Routes, Route } from 'react-router-dom';
import UsersListPage from './UsersListPage';

// Mounted at the admin `users/*` splat route. The list owns create/edit (modal)
// and delete (confirm) flows, so there is no dedicated detail route.
export default function UsersSection() {
    return (
        <Routes>
            <Route index element={<UsersListPage />} />
        </Routes>
    );
}
