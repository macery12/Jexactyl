import { Routes, Route } from 'react-router-dom';
import FileBrowser from './components/FileBrowser';
import FileEditor from './components/FileEditor';

// Mounted at the server `files/*` splat. The index is the directory browser
// (current folder tracked in the URL hash, matching V1); `new` and `edit/*`
// render the CodeMirror editor.
export default function FilesSection() {
    return (
        <Routes>
            <Route index element={<FileBrowser />} />
            <Route path="new" element={<FileEditor action="new" />} />
            <Route path="edit/*" element={<FileEditor action="edit" />} />
        </Routes>
    );
}
