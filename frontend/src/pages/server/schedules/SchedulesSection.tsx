import { Routes, Route } from 'react-router-dom';
import SchedulesListPage from './SchedulesListPage';
import ScheduleDetailPage from './ScheduleDetailPage';

// Mounted at the server `schedules/*` splat. The index lists schedules (create /
// run / delete inline); `:scheduleId` is the dedicated tasks editor.
export default function SchedulesSection() {
    return (
        <Routes>
            <Route index element={<SchedulesListPage />} />
            <Route path=":scheduleId" element={<ScheduleDetailPage />} />
        </Routes>
    );
}
