import { cleanDirectoryPath } from '@/lib/helpers';
import type { Action } from 'easy-peasy';
import { action } from 'easy-peasy';

interface FileUploadData {
    loaded: number;
    readonly abort: AbortController;
    readonly total: number;
}

export type SortField = 'name' | 'modified' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';

interface ServerFileStore {
    directory: string;
    selectedFiles: string[];
    uploads: Record<string, FileUploadData>;
    sortField: SortField;
    sortDirection: SortDirection;
    searchTerm: string;

    setDirectory: Action<ServerFileStore, string>;
    setSelectedFiles: Action<ServerFileStore, string[]>;
    appendSelectedFile: Action<ServerFileStore, string>;
    removeSelectedFile: Action<ServerFileStore, string>;
    setSortField: Action<ServerFileStore, SortField>;
    setSortDirection: Action<ServerFileStore, SortDirection>;
    setSearchTerm: Action<ServerFileStore, string>;

    pushFileUpload: Action<ServerFileStore, { name: string; data: FileUploadData }>;
    setUploadProgress: Action<ServerFileStore, { name: string; loaded: number }>;
    clearFileUploads: Action<ServerFileStore>;
    removeFileUpload: Action<ServerFileStore, string>;
    cancelFileUpload: Action<ServerFileStore, string>;
}

const files: ServerFileStore = {
    directory: '/',
    selectedFiles: [],
    uploads: {},
    sortField: 'name',
    sortDirection: 'asc',
    searchTerm: '',

    setDirectory: action((state, payload) => {
        state.directory = cleanDirectoryPath(payload);
    }),

    setSelectedFiles: action((state, payload) => {
        state.selectedFiles = payload;
    }),

    appendSelectedFile: action((state, payload) => {
        state.selectedFiles = state.selectedFiles.filter(f => f !== payload).concat(payload);
    }),

    removeSelectedFile: action((state, payload) => {
        state.selectedFiles = state.selectedFiles.filter(f => f !== payload);
    }),

    setSortField: action((state, payload) => {
        state.sortField = payload;
    }),

    setSortDirection: action((state, payload) => {
        state.sortDirection = payload;
    }),

    setSearchTerm: action((state, payload) => {
        state.searchTerm = payload;
    }),

    clearFileUploads: action(state => {
        Object.values(state.uploads).forEach(upload => upload.abort.abort());

        state.uploads = {};
    }),

    pushFileUpload: action((state, payload) => {
        state.uploads[payload.name] = payload.data;
    }),

    setUploadProgress: action((state, { name, loaded }) => {
        const upload = state.uploads[name];
        if (upload === undefined) {
            return;
        }

        upload.loaded = loaded;
    }),

    removeFileUpload: action((state, payload) => {
        const upload = state.uploads[payload];
        if (upload === undefined) {
            return;
        }

        delete state.uploads[payload];
    }),

    cancelFileUpload: action((state, payload) => {
        const upload = state.uploads[payload];
        if (upload === undefined) {
            return;
        }

        // Abort the request if it is still in flight. If it already completed this is
        // a no-op.
        upload.abort.abort();

        delete state.uploads[payload];
    }),
};

export type { FileUploadData, ServerFileStore };
export default files;
