import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { type Mod, type ServerModsConfig } from '@/api/routes/server/mods';
import { type ModpackVersion, getModpackVersions, previewModpackInstall, type ModpackPreview } from '@/api/routes/server/modpacks';
import Spinner from '@/elements/Spinner';
import ModpackInstallWizard from './ModpackInstallWizard';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faDownload } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

interface Props {
    modpack: Mod;
    onClose: () => void;
    detectedConfig: ServerModsConfig | null;
    // Active browse filters, so the version list matches what the user is browsing.
    filterLoader?: string;
    filterGameVersion?: string;
}

const formatBytes = (bytes: number): string => {
    if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
    if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB';
    if (bytes >= 1_024) return (bytes / 1_024).toFixed(1) + ' KB';
    return bytes + ' B';
};

const releaseTypeLabel = (t: string) => {
    if (t === 'alpha') return { label: 'Alpha', cls: 'bg-red-900 text-red-300' };
    if (t === 'beta')  return { label: 'Beta',  cls: 'bg-yellow-900 text-yellow-300' };
    return { label: 'Release', cls: 'bg-green-900 text-green-300' };
};

export default function ModpackDetails({ modpack, onClose, detectedConfig, filterLoader, filterGameVersion }: Props) {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { colors } = useStoreState(state => state.theme.data!);

    const [versions, setVersions] = useState<ModpackVersion[]>([]);
    const [loadingVersions, setLoadingVersions] = useState(true);
    const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [preview, setPreview] = useState<ModpackPreview | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoadingVersions(true);
        getModpackVersions(uuid, modpack.id, filterGameVersion ?? detectedConfig?.detectedVersion ?? undefined, filterLoader)
            .then(res => {
                setVersions(res.data);
                if (res.data.length > 0) setSelectedVersionId(res.data[0]!.id);
            })
            .catch(() => setError('Failed to load versions.'))
            .finally(() => setLoadingVersions(false));
    }, [uuid, modpack.id, filterGameVersion, filterLoader, detectedConfig?.detectedVersion]);

    const handlePreviewInstall = () => {
        if (selectedVersionId === null) return;
        setError(null);
        setLoadingPreview(true);
        previewModpackInstall(uuid, modpack.id, selectedVersionId)
            .then(p => {
                setPreview(p);
                setShowWizard(true);
            })
            .catch(e => setError(e?.response?.data?.error ?? 'Failed to load modpack preview.'))
            .finally(() => setLoadingPreview(false));
    };

    const selectedVersion = versions.find(v => v.id === selectedVersionId);

    return (
        <>
            {/* Backdrop */}
            <div
                css={tw`fixed inset-0 z-40 bg-black/70 backdrop-blur-sm`}
                onClick={onClose}
            />

            {/* Modal */}
            <div css={tw`fixed inset-0 z-50 flex items-center justify-center p-4`}>
                <div css={tw`bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto`}>
                    {/* Header */}
                    <div css={tw`flex items-start gap-4 p-6 border-b border-neutral-700`}>
                        {modpack.logo?.thumbnailUrl ? (
                            <img src={modpack.logo.thumbnailUrl} alt={modpack.name} css={tw`w-16 h-16 rounded-lg flex-shrink-0 bg-neutral-800 object-cover`} />
                        ) : (
                            <div css={tw`w-16 h-16 rounded-lg flex-shrink-0 bg-neutral-700 flex items-center justify-center text-2xl`}>📦</div>
                        )}
                        <div css={tw`flex-1 min-w-0`}>
                            <h2 css={tw`text-lg font-bold text-neutral-100 mb-1`}>{modpack.name}</h2>
                            <p css={tw`text-sm text-neutral-400`}>by {modpack.authors[0]?.name ?? 'Unknown'}</p>
                            <div css={tw`flex items-center gap-3 mt-2 text-xs text-neutral-500`}>
                                <span><FontAwesomeIcon icon={faDownload} css={tw`mr-1`} />{modpack.downloadCount.toLocaleString()} downloads</span>
                            </div>
                        </div>
                        <button css={tw`text-neutral-400 hover:text-neutral-200 transition-colors flex-shrink-0`} onClick={onClose}>
                            <FontAwesomeIcon icon={faXmark} css={tw`text-xl`} />
                        </button>
                    </div>

                    {/* Body */}
                    <div css={tw`p-6 space-y-5`}>
                        {modpack.summary && (
                            <p css={tw`text-sm text-neutral-300`}>{modpack.summary}</p>
                        )}

                        {/* Version selector */}
                        <div>
                            <label css={tw`block text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2`}>
                                Select Version
                            </label>
                            {loadingVersions ? (
                                <Spinner size="small" />
                            ) : versions.length === 0 ? (
                                <p css={tw`text-sm text-neutral-500`}>
                                    No compatible versions found
                                    {detectedConfig?.detectedVersion ? ` for Minecraft ${detectedConfig.detectedVersion}` : ''}.
                                </p>
                            ) : (
                                <select
                                    value={selectedVersionId ?? ''}
                                    onChange={e => setSelectedVersionId(Number(e.target.value))}
                                    css={tw`w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500`}
                                >
                                    {versions.map(v => {
                                        const rt = releaseTypeLabel(v.release_type);
                                        return (
                                            <option key={v.id} value={v.id}>
                                                {v.name} ({v.game_versions.slice(0, 2).join(', ')}) — {rt.label}
                                                {v.file_length ? ` · ${formatBytes(v.file_length)}` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            )}

                            {selectedVersion && (
                                <div css={tw`mt-2 flex flex-wrap gap-2`}>
                                    {selectedVersion.loaders.map(l => (
                                        <span key={l} css={tw`text-xs bg-neutral-700 px-2 py-0.5 rounded capitalize`}>{l}</span>
                                    ))}
                                    {selectedVersion.game_versions.slice(0, 4).map(v => (
                                        <span key={v} css={tw`text-xs bg-neutral-700 px-2 py-0.5 rounded`}>{v}</span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {error && (
                            <p css={tw`text-sm text-red-400 bg-red-900 border border-red-700 rounded px-3 py-2`}>{error}</p>
                        )}

                        {/* Install button */}
                        <button
                            type="button"
                            disabled={selectedVersionId === null || loadingVersions || loadingPreview}
                            onClick={handlePreviewInstall}
                            css={tw`w-full py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                            style={{ backgroundColor: colors.primary, color: '#fff' }}
                        >
                            {loadingPreview ? (
                                <span css={tw`flex items-center justify-center gap-2`}>
                                    <Spinner size="small" />
                                    Preparing preview…
                                </span>
                            ) : 'Preview & Install'}
                        </button>
                    </div>
                </div>
            </div>

            {showWizard && preview && selectedVersion && (
                <ModpackInstallWizard
                    modpack={modpack}
                    version={selectedVersion}
                    preview={preview}
                    onClose={() => setShowWizard(false)}
                    onInstalled={() => { setShowWizard(false); onClose(); }}
                />
            )}
        </>
    );
}
