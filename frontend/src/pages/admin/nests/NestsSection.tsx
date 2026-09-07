import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';
import { Spinner } from '@/components/ui/Spinner';

const NestsWorkspace = lazy(() => import('./NestsWorkspace'));
const EggEditorPage = lazy(() => import('./egg/EggEditorPage'));

// Mounted at the admin `nests/*` splat route. The workspace is a master–detail
// view (nest rail + selected nest's detail and eggs). The egg editor is a
// focused, full-width route, so it renders without the rail.
//
// The registry gates this whole section on `nests.read`, but V1 additionally
// gated its two egg routes on `eggs.read` (`nests/:nestId/new` and
// `nests/:nestId/eggs/:id/*`). Merging them under one splat dropped that second
// gate, letting anyone with `nests.read` edit eggs — a privilege widening, not
// just a missing check. The registry is flat, so the gate is restored here.
// See docs/v1-cutover/01-audit-findings.md #3 (gaps 10-11).
const newEggEditor = (
    <RequireAdminPermission permission="eggs.create">
        <EggEditorPage />
    </RequireAdminPermission>
);
const existingEggEditor = (
    <RequireAdminPermission permission="eggs.update">
        <EggEditorPage />
    </RequireAdminPermission>
);

export default function NestsSection() {
    return (
        <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-7 w-7" /></div>}>
            <Routes>
                <Route path=":nestId/eggs/new" element={newEggEditor} />
                <Route path=":nestId/eggs/:eggId" element={existingEggEditor} />
                <Route index element={<NestsWorkspace />} />
                <Route path=":nestId" element={<NestsWorkspace />} />
            </Routes>
        </Suspense>
    );
}
