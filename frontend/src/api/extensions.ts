import http from '@/lib/http';

// Admin extension catalog view-models. Mirrors the shapes emitted by
// ExtensionCatalogService (app/Services/Extensions). The application API
// (/api/application/extensions) is session-authed same-origin, so the shared
// http client works as-is. Strings sourced from a manifest (name, description,
// author, source label, security warning, settings-schema labels) are rendered
// verbatim and intentionally NOT routed through the i18n catalog.

export type ExtensionStatus = 'core' | 'installed' | 'available';
export type ExtensionType = 'user' | 'admin' | 'both';

export interface ExtensionSource {
    type: 'core' | 'repository';
    label: string;
    official: boolean;
    repositoryId: number | null;
    repositoryName: string | null;
    homepageUrl: string | null;
    securityWarning: string | null;
}

// A single field in an extension's settings schema (manifest-defined).
export interface ExtensionSettingField {
    key: string;
    label: string;
    type: string; // text | textarea | number | boolean | select | password | …
    description?: string;
    placeholder?: string;
    default?: unknown;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
}

export interface Extension {
    id: string;
    name: string;
    description: string;
    version: string;
    latestVersion: string;
    author: string;
    icon: string;
    route: string;
    // Surface type derived by the panel from the manifest. 'user' = per-server
    // page, 'admin' = admin page only (no per-server access scoping), 'both'.
    type: ExtensionType;
    hasServerPage: boolean;
    enabled: boolean;
    allowedNests: number[];
    allowedEggs: number[];
    settings: Record<string, unknown>;
    settingsSchema: ExtensionSettingField[];
    installed: boolean;
    installable: boolean;
    canUninstall: boolean;
    // True when the package ships migrations (i.e. it created database tables).
    // The uninstall drawer only offers the drop-tables option when this is set.
    hasDatabase: boolean;
    status: ExtensionStatus;
    updateAvailable: boolean;
    // False only for an *available* (repository) extension whose declared
    // compatiblePanelVersions exclude the running panel. Installed/core/manual
    // extensions are always true — compatibility gates repo fetches, not what's
    // already on disk. Drives the "incompatible" badge + a blocked Install button.
    compatible: boolean;
    compatiblePanelVersions: string[];
    source: ExtensionSource;
}

export interface Repository {
    id: number;
    slug: string;
    name: string;
    manifestUrl: string;
    homepageUrl: string | null;
    enabled: boolean;
    official: boolean;
    packagesCount: number;
    securityWarning: string | null;
    status?: 'ok' | 'disabled' | 'error';
    error?: string;
}

export interface OperationProgress {
    action: string; // install | uninstall | update | batch-install | …
    extension_id: string;
    stage: string;
    started_at: string;
    updated_at: string;
    batch_total?: number;
    batch_current?: number;
    batch_extensions?: string[];
}

export interface NestOption {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
}

export interface EggOption {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    nestId: number;
    nestName: string;
}

const BASE = '/api/application/extensions';

// GET /extensions — the full catalog (core + installed + available).
export async function getExtensions(): Promise<Extension[]> {
    const { data } = await http.get(BASE);
    return (data.data ?? []) as Extension[];
}

// GET /extensions/repositories — configured repositories + their health.
export async function getRepositories(): Promise<Repository[]> {
    const { data } = await http.get(`${BASE}/repositories`);
    return (data.data ?? []) as Repository[];
}

// POST /extensions/refresh — bust the manifest cache and return fresh extensions.
export async function refreshCatalog(): Promise<Extension[]> {
    const { data } = await http.post(`${BASE}/refresh`);
    return (data.data ?? []) as Extension[];
}

// GET /extensions/nests-eggs — nests + eggs for the access-control picker.
export async function getNestsAndEggs(): Promise<{ nests: NestOption[]; eggs: EggOption[] }> {
    const { data } = await http.get(`${BASE}/nests-eggs`);
    return { nests: data.nests ?? [], eggs: data.eggs ?? [] };
}

// GET /extensions/progress — current install/uninstall/update stage (null when idle).
export async function getProgress(): Promise<OperationProgress | null> {
    const { data } = await http.get(`${BASE}/progress`);
    return (data.progress ?? null) as OperationProgress | null;
}

export interface UpdateExtensionPayload {
    enabled?: boolean;
    allowedNests?: number[];
    allowedEggs?: number[];
    settings?: Record<string, unknown>;
}

// PUT /extensions/{id} — persist config (enabled, access, settings).
export async function updateExtension(id: string, payload: UpdateExtensionPayload): Promise<Extension> {
    const { data } = await http.put(`${BASE}/${id}`, {
        enabled: payload.enabled,
        allowed_nests: payload.allowedNests,
        allowed_eggs: payload.allowedEggs,
        settings: payload.settings,
    });
    return data.attributes as Extension;
}

// POST /extensions/{id}/toggle — flip enabled state.
export async function toggleExtension(id: string): Promise<Extension> {
    const { data } = await http.post(`${BASE}/${id}/toggle`);
    return data.attributes as Extension;
}

// POST /extensions/{id}/install — install a repository-backed package.
export async function installExtension(id: string, repositoryId: number, version?: string): Promise<Extension> {
    const { data } = await http.post(`${BASE}/${id}/install`, { repository_id: repositoryId, version });
    return data.attributes as Extension;
}

// POST /extensions/{id}/update-package — update an installed package to a newer version.
export async function updateExtensionPackage(id: string, repositoryId: number, version?: string): Promise<Extension> {
    const { data } = await http.post(`${BASE}/${id}/update-package`, { repository_id: repositoryId, version });
    return data.attributes as Extension;
}

export interface UninstallResult {
    extension: Extension;
    // Database tables are preserved by default; dropData rolls the extension's
    // migrations back server-side after an explicit typed confirmation.
    dataDropped: boolean;
    preservedTables: string[];
    manualCleanup: string[];
}

// POST /extensions/{id}/uninstall — remove an installed package. Pass dropData
// (with confirm === id) to also drop the extension's database tables.
export async function uninstallExtension(id: string, dropData = false, confirm?: string): Promise<UninstallResult> {
    const { data } = await http.post(`${BASE}/${id}/uninstall`, dropData ? { drop_data: true, confirm } : {});
    return {
        extension: data.attributes as Extension,
        dataDropped: Boolean(data.meta?.data_dropped),
        preservedTables: (data.meta?.preserved_tables ?? []) as string[],
        manualCleanup: (data.meta?.manual_cleanup ?? []) as string[],
    };
}

export interface RepositoryPayload {
    name: string;
    manifestUrl?: string;
    homepageUrl?: string | null;
    enabled?: boolean;
    // Only required when adding a repository: the operator must acknowledge that
    // a repository can run arbitrary code. The backend enforces `required|accepted`.
    acknowledgeRisk?: boolean;
}

// POST /extensions/repositories — register a new repository.
export async function storeRepository(payload: RepositoryPayload): Promise<Repository> {
    const { data } = await http.post(`${BASE}/repositories`, {
        name: payload.name,
        manifest_url: payload.manifestUrl,
        homepage_url: payload.homepageUrl,
        enabled: payload.enabled,
        acknowledge_risk: payload.acknowledgeRisk,
    });
    return data.attributes as Repository;
}

// PATCH /extensions/repositories/{id} — edit an existing repository.
export async function updateRepository(id: number, payload: RepositoryPayload): Promise<Repository> {
    const { data } = await http.patch(`${BASE}/repositories/${id}`, {
        name: payload.name,
        manifest_url: payload.manifestUrl,
        homepage_url: payload.homepageUrl,
        enabled: payload.enabled,
    });
    return data.attributes as Repository;
}

// DELETE /extensions/repositories/{id} — remove a custom repository.
export async function deleteRepository(id: number): Promise<void> {
    await http.delete(`${BASE}/repositories/${id}`);
}

// A single item in a batch install/update payload.
export interface BatchInstallItem {
    extensionId: string;
    repositoryId: number;
    version?: string;
}

// POST /extensions/batch-install — install several packages in one rebuild.
export async function batchInstallExtensions(items: BatchInstallItem[]): Promise<Extension[]> {
    const { data } = await http.post(`${BASE}/batch-install`, {
        extensions: items.map(i => ({ extension_id: i.extensionId, repository_id: i.repositoryId, version: i.version })),
    });
    return (data.data ?? []) as Extension[];
}

// POST /extensions/batch-uninstall — remove several packages in one rebuild.
// Data is always preserved for batch uninstalls; dropping tables stays a
// single-extension, typed-confirmation operation.
export async function batchUninstallExtensions(extensionIds: string[]): Promise<Extension[]> {
    const { data } = await http.post(`${BASE}/batch-uninstall`, { extension_ids: extensionIds });
    return (data.data ?? []) as Extension[];
}

// POST /extensions/batch-update — update several packages in one rebuild.
export async function batchUpdateExtensions(items: BatchInstallItem[]): Promise<Extension[]> {
    const { data } = await http.post(`${BASE}/batch-update`, {
        extensions: items.map(i => ({ extension_id: i.extensionId, repository_id: i.repositoryId, version: i.version })),
    });
    return (data.data ?? []) as Extension[];
}
