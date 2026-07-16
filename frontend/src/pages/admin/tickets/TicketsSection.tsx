import { Routes, Route } from 'react-router-dom';
import TicketsListPage from './TicketsListPage';
import AdminTicketDetailPage from './AdminTicketDetailPage';

// Mounted at the admin `tickets/*` splat route. Owns the staff queue (index) and
// the per-ticket console (`:id`).
export default function TicketsSection() {
    return (
        <Routes>
            <Route index element={<TicketsListPage />} />
            <Route path=":id" element={<AdminTicketDetailPage />} />
        </Routes>
    );
}
