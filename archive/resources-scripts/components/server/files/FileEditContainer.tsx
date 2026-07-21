import type { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { dirname } from 'pathe';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import tw from 'twin.macro';

import { httpErrorToHuman } from '@/api/http';
import { getFileContents, saveFileContents } from '@/api/routes/server/files';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { Button } from '@/elements/button';
import Can from '@/elements/Can';
import Select from '@/elements/Select';
import PageContentBlock from '@/elements/PageContentBlock';
import { ServerError } from '@/elements/ScreenBlock';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import FileManagerBreadcrumbs from '@server/files/FileManagerBreadcrumbs';
import FileNameModal from '@server/files/FileNameModal';
import ErrorBoundary from '@/elements/ErrorBoundary';
import { Editor } from '@/elements/editor';
import useFlash from '@/plugins/useFlash';
import { ServerContext } from '@/state/server';
import { encodePathSegments } from '@/lib/helpers';

const isArchiveType = (name: string): boolean => {
    const lower = name.toLowerCase();

    return [
        '.zip',
        '.7z',
        '.ddup',
        '.tar',
        '.tar.gz',
        '.tgz',
        '.tar.xz',
        '.txz',
        '.tar.zst',
        '.tzst',
        '.tar.lz4',
        '.tlz4',
        '.tar.bz2',
        '.tbz2',
        '.gz',
        '.xz',
        '.zst',
        '.lz4',
        '.bz2',
    ].some(extension => lower.endsWith(extension));
};

const isArchiveReadonlyPath = (path: string): boolean => {
    const segments = path
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean);

    if (segments.length === 0) {
        return false;
    }

    return segments.some(isArchiveType);
};

export default () => {
    const [error, setError] = useState('');
    const { action, '*': rawFilename } = useParams<{ action: 'edit' | 'new'; '*': string }>();
    const [loading, setLoading] = useState(action === 'edit');
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [modalVisible, setModalVisible] = useState(false);
    const [language, setLanguage] = useState<LanguageDescription>();

    const [filename, setFilename] = useState<string>('');
    const isArchiveReadonly = action === 'edit' && isArchiveReadonlyPath(filename);

    useEffect(() => {
        setFilename(decodeURIComponent(rawFilename ?? ''));
    }, [rawFilename]);

    const navigate = useNavigate();

    const id = ServerContext.useStoreState(state => state.server.data!.id);
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const setDirectory = ServerContext.useStoreActions(actions => actions.files.setDirectory);
    const { addError, clearFlashes } = useFlash();

    const fetchFileContent = useRef<null | (() => Promise<string>)>(null);

    useEffect(() => {
        if (action === 'new') {
            return;
        }

        if (filename === '') {
            return;
        }

        const controller = new AbortController();
        setError('');
        setLoading(true);
        setDirectory(dirname(filename));
        getFileContents(uuid, filename, { signal: controller.signal })
            .then(fileContent => {
                setContent(fileContent);
                setOriginalContent(fileContent);
            })
            .catch(error => {
                console.error(error);
                setError(httpErrorToHuman(error));
            })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [action, uuid, filename]);

    const save = (name?: string) => {
        if (isArchiveReadonly) {
            addError({ message: 'You cannot write to a file inside an archive. Extract it first.', key: 'files:view' });
            return;
        }

        if (!fetchFileContent.current) {
            return;
        }

        setLoading(true);
        clearFlashes('files:view');
        fetchFileContent
            .current()
            .then(newContent => {
                // Pass original content for diff calculation (use empty string for new files)
                const original = action === 'new' ? '' : originalContent;
                return saveFileContents(uuid, name ?? filename, newContent, original).then(() => {
                    // Update original content after successful save
                    setOriginalContent(newContent);
                });
            })
            .then(() => {
                if (name) {
                    navigate(`/server/${id}/files/edit/${encodePathSegments(name)}`);
                    return;
                }

                return Promise.resolve();
            })
            .catch(error => {
                console.error(error);
                addError({ message: httpErrorToHuman(error), key: 'files:view' });
            })
            .then(() => setLoading(false));
    };

    if (error) {
        // TODO: onBack
        return <ServerError message={error} />;
    }

    return (
        <PageContentBlock>
            <FlashMessageRender byKey={'files:view'} css={tw`mb-4`} />

            <ErrorBoundary>
                <div css={tw`mb-4`}>
                    <FileManagerBreadcrumbs withinFileEditor isNewFile={action !== 'edit'} />
                </div>
            </ErrorBoundary>

            {filename === '.pteroignore' ? (
                <div css={tw`mb-4 p-4 border-l-4 bg-neutral-900 rounded border-cyan-400`}>
                    <p css={tw`text-neutral-300 text-sm`}>
                        You&apos;re editing a <code css={tw`font-mono bg-black rounded py-px px-1`}>.pteroignore</code>{' '}
                        file. Any files or directories listed in here will be excluded from backups. Wildcards are
                        supported by using an asterisk (<code css={tw`font-mono bg-black rounded py-px px-1`}>*</code>).
                        You can negate a prior rule by prepending an exclamation point (
                        <code css={tw`font-mono bg-black rounded py-px px-1`}>!</code>).
                    </p>
                </div>
            ) : null}

            <FileNameModal
                visible={modalVisible}
                onDismissed={() => setModalVisible(false)}
                onFileNamed={name => {
                    setModalVisible(false);
                    save(name);
                }}
            />

            <div css={tw`relative`}>
                <SpinnerOverlay visible={loading} />
                <Editor
                    style={{ height: 'calc(100vh - 20rem)' }}
                    childClassName={tw`rounded-md h-full`}
                    filename={filename}
                    initialContent={content}
                    language={language}
                    onLanguageChanged={l => {
                        setLanguage(l);
                    }}
                    fetchContent={value => {
                        fetchFileContent.current = value;
                    }}
                    onContentSaved={
                        isArchiveReadonly
                            ? undefined
                            : () => {
                                  if (action !== 'edit') {
                                      setModalVisible(true);
                                  } else {
                                      save();
                                  }
                              }
                    }
                />
            </div>

            <div css={tw`flex justify-end mt-4`}>
                <div css={tw`flex-1 sm:flex-none rounded bg-neutral-900 mr-4`}>
                    <Select
                        value={language?.name ?? ''}
                        onChange={e => {
                            setLanguage(languages.find(l => l.name === e.target.value));
                        }}
                    >
                        {languages.map(language => (
                            <option key={language.name} value={language.name}>
                                {language.name}
                            </option>
                        ))}
                    </Select>
                </div>

                {action === 'edit' ? (
                    <Can action={'file.update'}>
                        <Button css={tw`flex-1 sm:flex-none`} onClick={() => save()} disabled={isArchiveReadonly}>
                            {isArchiveReadonly ? 'Read-only' : 'Save Content'}
                        </Button>
                    </Can>
                ) : (
                    <Can action={'file.create'}>
                        <Button css={tw`flex-1 sm:flex-none`} onClick={() => setModalVisible(true)}>
                            Create File
                        </Button>
                    </Can>
                )}
            </div>
        </PageContentBlock>
    );
};
