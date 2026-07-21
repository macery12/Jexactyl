import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import styled from 'styled-components';
import Modal from '@/elements/Modal';
import { type Mod, type ModFile, getModFiles } from '@/api/routes/server/mods';
import { ServerContext } from '@/state/server';
import Spinner from '@/elements/Spinner';
import { httpErrorToHuman } from '@/api/http';
import useFlash from '@/plugins/useFlash';
import ModDownloadButton from './ModDownloadButton';
import FadeTransition from '@/elements/transitions/FadeTransition';
import { useStoreState } from '@/state/hooks';

interface Props {
    mod: Mod;
    onClose: () => void;
    source: 'modrinth' | 'spigot' | string;
    gameVersion?: string;
    modLoaderType?: number;
    contentType?: 'mods' | 'plugins';
    platform?: string | string[];
}

// Mod loader type ID to name mapping
const LOADER_NAMES: { [key: number]: string } = {
    1: 'Forge',
    2: 'Cauldron',
    3: 'LiteLoader',
    4: 'Fabric',
    5: 'Quilt',
    6: 'NeoForge',
};

const ModalContent = styled.div`
    ${tw`text-white`}
`;

const ModHeader = styled.div`
    ${tw`flex items-start gap-4 mb-6`}
`;

const ModLogo = styled.img`
    ${tw`w-24 h-24 rounded object-cover flex-shrink-0`}
`;

const ModTitle = styled.h2`
    ${tw`text-2xl font-bold mb-2`}
`;

const ModAuthors = styled.p`
    ${tw`text-neutral-300 text-sm mb-2`}
`;

const ModStats = styled.div`
    ${tw`flex gap-4 text-sm text-neutral-400`}
`;

const ModSummary = styled.p`
    ${tw`text-neutral-300 mb-6`}
`;

const Section = styled.div`
    ${tw`mb-6`}
`;

const SectionTitle = styled.h3`
    ${tw`text-lg font-semibold mb-3`}
`;

const FileList = styled.div`
    ${tw`space-y-2`}
`;

const FileItem = styled.div<{ $backgroundColor?: string }>`
    ${tw`rounded p-3 flex items-center justify-between`}
    background-color: ${props => props.$backgroundColor || '#404040'};
`;

const FileInfo = styled.div`
    ${tw`flex-1`}
`;

const FileName = styled.p`
    ${tw`text-white font-medium mb-1`}
`;

const FileDetails = styled.p`
    ${tw`text-xs text-neutral-400`}
`;

const getReleaseTypeLabel = (type: number) => {
    switch (type) {
        case 1:
            return 'Release';
        case 2:
            return 'Beta';
        case 3:
            return 'Alpha';
        default:
            return 'Unknown';
    }
};

const getReleaseTypeColor = (type: number) => {
    switch (type) {
        case 1:
            return tw`text-green-400`;
        case 2:
            return tw`text-yellow-400`;
        case 3:
            return tw`text-red-400`;
        default:
            return tw`text-neutral-400`;
    }
};

export default ({ mod, onClose, source, gameVersion, modLoaderType, contentType = 'mods', platform }: Props) => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { addError } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);
    const allowExternalDownloads = useStoreState(state => state.everest.data?.mods?.allow_external_downloads ?? false);

    const [files, setFiles] = useState<ModFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAllFiles, setShowAllFiles] = useState(false);
    const isPremium = mod.isPremium;
    const isExternal = mod.isExternal;
    const externalUrl = mod.externalUrl;

    const decodeBase64ToText = (value?: string | null): string | null => {
        if (!value) return null;
        try {
            const decoded = atob(value);
            // Spiget descriptions arrive as base64-encoded HTML. We parse with DOMParser then
            // read textContent (NOT innerHTML) so all tags are stripped — preserving this is
            // essential; switching to innerHTML would introduce stored XSS from provider data.
            const doc = new DOMParser().parseFromString(decoded, 'text/html');
            return doc.body.textContent || '';
        } catch {
            return null;
        }
    };

    const descriptionText = decodeBase64ToText(mod.description);
    const documentationText = decodeBase64ToText(mod.documentation);

    useEffect(() => {
        setLoading(true);
        getModFiles(uuid, mod.id, {
            pageSize: 20,
            index: 0,
            source: source as 'modrinth' | 'spigot' | undefined,
            gameVersion,
            modLoaderType,
            resource: contentType,
            platform,
        })
            .then(response => {
                setFiles(response.data);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'mods', message: httpErrorToHuman(error) });
            })
            .finally(() => setLoading(false));
    }, [uuid, mod.id, source, gameVersion, modLoaderType, platform]);

    const displayFiles = showAllFiles ? files : files.slice(0, 5);

    return (
        <Modal visible onDismissed={onClose}>
            <ModalContent>
                <ModHeader>
                    <ModLogo
                        src={mod.logo?.url || '/assets/images/placeholder-mod.png'}
                        alt={mod.name}
                        onError={e => {
                            const target = e.currentTarget;
                            // Prevent infinite loop by checking if already set to placeholder
                            if (!target.dataset.fallbackAttempted) {
                                target.dataset.fallbackAttempted = 'true';
                                target.src = '/assets/images/placeholder-mod.png';
                            }
                        }}
                    />
                    <div css={tw`flex-1`}>
                        <ModTitle>{mod.name}</ModTitle>
                        <ModAuthors>By {mod.authors.map(a => a.name).join(', ') || 'Unknown'}</ModAuthors>
                        <ModStats>
                            <span>{mod.downloadCount.toLocaleString()} downloads</span>
                            <span>•</span>
                            <span>Updated {new Date(mod.dateModified).toLocaleDateString()}</span>
                            {mod.rating && (
                                <>
                                    <span>•</span>
                                    <span>
                                        Rating {mod.rating.average?.toFixed?.(2) ?? 'N/A'} ({mod.rating.count ?? 0})
                                    </span>
                                </>
                            )}
                            {isPremium && (
                                <>
                                    <span>•</span>
                                    <span css={tw`text-red-400`}>Premium resource</span>
                                </>
                            )}
                            {isExternal && (
                                <>
                                    <span>•</span>
                                    <span css={tw`text-yellow-400`}>External download (manual)</span>
                                </>
                            )}
                        </ModStats>
                    </div>
                </ModHeader>

                <ModSummary>{mod.summary}</ModSummary>

                {isExternal && allowExternalDownloads && (
                    <div css={tw`mb-4 rounded-md border border-yellow-500 border-opacity-30 bg-yellow-500 bg-opacity-10 px-3 py-2 text-xs text-yellow-400`}>
                        <strong>External source:</strong> This plugin is hosted outside of SpigotMC (e.g. GitHub or the
                        author&apos;s website). Downloads from unknown sources have been enabled by your administrator.
                    </div>
                )}

                {isExternal && !allowExternalDownloads && (
                    <Section>
                        <SectionTitle>External Download</SectionTitle>
                        <p css={tw`text-neutral-300 mb-3`}>
                            This download is hosted externally and can’t be installed automatically from the panel. You
                            can download it manually, or search for an alternative provider if available.
                        </p>
                        <div css={tw`flex gap-2 flex-wrap`}>
                            {externalUrl && (
                                <button
                                    css={tw`px-4 py-2 text-white rounded transition-colors text-sm`}
                                    style={{ backgroundColor: colors.primary }}
                                    onClick={() => window.open(externalUrl, '_blank', 'noopener,noreferrer')}
                                    type="button"
                                >
                                    Open Download Page
                                </button>
                            )}
                        </div>
                    </Section>
                )}

                {(descriptionText || documentationText || (mod.testedVersions && mod.testedVersions.length > 0)) && (
                    <Section>
                        <SectionTitle>Details</SectionTitle>
                        {mod.testedVersions && mod.testedVersions.length > 0 && (
                            <p css={tw`text-neutral-300 mb-2`}>
                                Tested versions (provided by author, may be incomplete):{' '}
                                <span css={tw`text-neutral-300`}>{mod.testedVersions.join(', ')}</span>
                            </p>
                        )}
                        {descriptionText && (
                            <p css={tw`text-neutral-300 mb-2 whitespace-pre-line`}>{descriptionText}</p>
                        )}
                        {documentationText && (
                            <p css={tw`text-neutral-400 text-sm whitespace-pre-line`}>{documentationText}</p>
                        )}
                    </Section>
                )}

                {mod.latestVersion && (mod.latestVersion.name || mod.latestVersion.releaseDate) && (
                    <Section>
                        <SectionTitle>Latest Version</SectionTitle>
                        <p css={tw`text-neutral-300`}>
                            {mod.latestVersion.name || 'Latest'} •{' '}
                            {mod.latestVersion.releaseDate
                                ? new Date(mod.latestVersion.releaseDate).toLocaleDateString()
                                : 'Unknown date'}{' '}
                            {mod.latestVersion.downloads !== undefined && `• ${mod.latestVersion.downloads} downloads`}
                            {mod.latestVersion.rating?.average !== undefined &&
                                ` • Rating ${mod.latestVersion.rating.average} (${
                                    mod.latestVersion.rating.count ?? 0
                                })`}
                        </p>
                    </Section>
                )}

                {mod.file && (
                    <Section>
                        <SectionTitle>File Info</SectionTitle>
                        <p css={tw`text-neutral-300`}>
                            Type: {mod.file.type ?? 'Unknown'}
                            {mod.file.size && mod.file.size > 0 && (
                                <>
                                    {' '}
                                    • Size: {(mod.file.size / 1024 / 1024).toFixed(2)} MB{' '}
                                    {mod.file.sizeUnit ? `(${mod.file.sizeUnit})` : ''}
                                </>
                            )}
                        </p>
                        {mod.file.externalUrl && (
                            <a
                                href={mod.file.externalUrl}
                                target="_blank"
                                rel="noreferrer"
                                css={tw`underline text-sm`}
                                style={{ color: colors.primary }}
                                onClick={e => e.stopPropagation()}
                            >
                                Open external download
                            </a>
                        )}
                    </Section>
                )}

                <Section>
                    <SectionTitle>
                        Available Files
                        {(gameVersion || modLoaderType) && (
                            <span css={tw`ml-2 text-sm font-normal text-neutral-400`}>
                                (Filtered: {gameVersion && <span style={{ color: colors.primary }}>{gameVersion}</span>}
                                {gameVersion && modLoaderType && ' • '}
                                {modLoaderType && (
                                    <span style={{ color: colors.primary }}>{LOADER_NAMES[modLoaderType] || 'Unknown'}</span>
                                )}
                                )
                            </span>
                        )}
                    </SectionTitle>
                    {loading ? (
                        <div css={tw`flex justify-center py-6`}>
                            <Spinner />
                        </div>
                    ) : files.length > 0 ? (
                        <FadeTransition duration="duration-150" show>
                            <FileList>
                                {displayFiles.map(file => (
                                    <FileItem key={file.id} $backgroundColor={colors.secondary}>
                                        <FileInfo>
                                            <FileName>{file.displayName}</FileName>
                                            <FileDetails>
                                                <span css={getReleaseTypeColor(file.releaseType)}>
                                                    {getReleaseTypeLabel(file.releaseType)}
                                                </span>
                                                {' • '}
                                                <span>
                                                    {file.gameVersions.slice(0, 3).join(', ')}
                                                    {file.gameVersions.length > 3 && '...'}
                                                </span>
                                                {' • '}
                                                <span>{new Date(file.fileDate).toLocaleDateString()}</span>
                                                {file.fileLength > 0 && (
                                                    <>
                                                        {' • '}
                                                        <span>{(file.fileLength / 1024 / 1024).toFixed(2)} MB</span>
                                                    </>
                                                )}
                                            </FileDetails>
                                        </FileInfo>
                                        <ModDownloadButton
                                            modId={mod.id}
                                            fileId={file.id}
                                            fileName={file.fileName}
                                            source={source}
                                            contentType={contentType}
                                            disabledReason={
                                                isPremium
                                                    ? 'Premium (blocked)'
                                                    : isExternal && !allowExternalDownloads
                                                      ? 'External only'
                                                      : undefined
                                            }
                                        />
                                    </FileItem>
                                ))}
                            </FileList>
                            {files.length > 5 && !showAllFiles && (
                                <button
                                    onClick={() => setShowAllFiles(true)}
                                    css={tw`mt-3 text-sm text-neutral-400 hover:text-neutral-200 transition-colors`}
                                >
                                    Show {files.length - 5} more files...
                                </button>
                            )}
                        </FadeTransition>
                    ) : (
                        <p css={tw`text-neutral-400 text-center py-6`}>No files available for download.</p>
                    )}
                </Section>

                {mod.screenshots && mod.screenshots.length > 0 && (
                    <Section>
                        <SectionTitle>Screenshots</SectionTitle>
                        <div css={tw`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
                            {mod.screenshots.slice(0, 4).map((screenshot, idx) => (
                                <img
                                    key={screenshot.id || idx}
                                    src={screenshot.thumbnailUrl}
                                    alt={screenshot.title}
                                    css={tw`rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                    onClick={() => window.open(screenshot.url, '_blank', 'noopener,noreferrer')}
                                />
                            ))}
                        </div>
                    </Section>
                )}
            </ModalContent>
        </Modal>
    );
};
