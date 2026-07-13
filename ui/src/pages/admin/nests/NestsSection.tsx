import { Routes, Route } from 'react-router-dom';
import NestsWorkspace from './NestsWorkspace';
import EggEditorPage from './egg/EggEditorPage';

// Mounted at the admin `nests/*` splat route. The workspace is a master–detail
// view (nest rail + selected nest's detail and eggs). The egg editor is a
// focused, full-width route, so it renders without the rail.
export default function NestsSection() {
    return (
        <Routes>
            <Route path=":nestId/eggs/new" element={<EggEditorPage />} />
            <Route path=":nestId/eggs/:eggId" element={<EggEditorPage />} />
            <Route index element={<NestsWorkspace />} />
            <Route path=":nestId" element={<NestsWorkspace />} />
        </Routes>
    );
}
