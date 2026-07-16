import { Routes, Route } from 'react-router-dom';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';
import NestsWorkspace from './NestsWorkspace';
import EggEditorPage from './egg/EggEditorPage';

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
const eggEditor = (
    <RequireAdminPermission permission="eggs.read">
        <EggEditorPage />
    </RequireAdminPermission>
);

export default function NestsSection() {
    return (
        <Routes>
            <Route path=":nestId/eggs/new" element={eggEditor} />
            <Route path=":nestId/eggs/:eggId" element={eggEditor} />
            <Route index element={<NestsWorkspace />} />
            <Route path=":nestId" element={<NestsWorkspace />} />
        </Routes>
    );
}
