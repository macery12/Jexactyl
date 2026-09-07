import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';

const SchedulesListPage = lazy(() => import('./SchedulesListPage'));
const ScheduleDetailPage = lazy(() => import('./ScheduleDetailPage'));

// Mounted at the server `schedules/*` splat. The index lists schedules (create /
// run / delete inline); `:scheduleId` is the dedicated tasks editor.
export default function SchedulesSection() {
    return (
        <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-7 w-7" /></div>}>
            <Routes>
                <Route index element={<SchedulesListPage />} />
                <Route path=":scheduleId" element={<ScheduleDetailPage />} />
            </Routes>
        </Suspense>
    );
}
