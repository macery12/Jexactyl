import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';

const FileBrowser = lazy(() => import('./components/FileBrowser'));
const FileEditor = lazy(() => import('./components/FileEditor'));

// Mounted at the server `files/*` splat. The index is the directory browser
// (current folder tracked in the URL hash, matching V1); `new` and `edit/*`
// render the CodeMirror editor.
export default function FilesSection() {
    return (
        <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-7 w-7" /></div>}>
            <Routes>
                <Route index element={<FileBrowser />} />
                <Route path="new" element={<FileEditor action="new" />} />
                <Route path="edit/*" element={<FileEditor action="edit" />} />
            </Routes>
        </Suspense>
    );
}
