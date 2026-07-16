import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import tw from 'twin.macro';
import { ArrowLeftIcon, XIcon } from '@heroicons/react/outline';
import { getFileContents, saveFileContents } from '@/api/routes/server/files';
import { type ServerRouteDefinition } from '@/routers/routes/utils';
import PermissionRoute from '@/elements/PermissionRoute';
import Spinner from '@/elements/Spinner';
import { NotFound } from '@/elements/ScreenBlock';
import { Editor } from '@/elements/editor';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';

export interface FloatingServerWindow {
    id: string;
    serverId: string;
    serverUuid: string;
    serverName: string;
    routePath: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
}

interface Props {
    windows: FloatingServerWindow[];
    currentServerId: string;
    onClose: (id: string) => void;
    onFocus: (id: string) => void;
    onMove: (id: string, x: number, y: number) => void;
    onResize: (id: string, width: number, height: number) => void;
    onNavigate: (id: string, routePath: string) => void;
    serverRoutes: ServerRouteDefinition[];
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 260;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const EmbeddedServerView = ({
    serverRoutes,
    routePath,
}: {
    serverRoutes: ServerRouteDefinition[];
    routePath: string;
}) => {
    const routeDefinition = serverRoutes.find(route => route.path === routePath);

    if (!routeDefinition) {
        return <NotFound />;
    }

    const Component = routeDefinition.component;

    return (
        <PermissionRoute permission={routeDefinition.permission}>
            <Spinner.Suspense>
                <Component />
            </Spinner.Suspense>
        </PermissionRoute>
    );
};

const FloatingFileEditor = ({ serverUuid, filename }: { serverUuid: string; filename: string }) => {
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [error, setError] = useState<string | null>(null);
    const fetchFileContentRef = useRef<null | (() => Promise<string>)>(null);

    useEffect(() => {
        if (!serverUuid || !filename) {
            setError('Invalid file target.');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        getFileContents(serverUuid, filename)
            .then(fileContent => {
                setContent(fileContent);
                setOriginalContent(fileContent);
            })
            .catch(() => setError('Failed to load file content.'))
            .finally(() => setLoading(false));
    }, [serverUuid, filename]);

    const onSave = async () => {
        if (!fetchFileContentRef.current || !serverUuid || !filename) {
            return;
        }

        setLoading(true);

        try {
            const newContent = await fetchFileContentRef.current();
            await saveFileContents(serverUuid, filename, newContent, originalContent);
            setOriginalContent(newContent);
        } catch {
            setError('Failed to save file content.');
        } finally {
            setLoading(false);
        }
    };

    if (loading && !content) {
        return <Spinner size={'large'} centered />;
    }

    if (error && !content) {
        return <div className={'p-4 text-sm text-red-300'}>{error}</div>;
    }

    return (
        <div className={'flex h-full flex-col'}>
            <div className={'px-4 py-2 text-xs text-neutral-400'}>{filename}</div>
            <div className={'min-h-0 flex-1 px-4 pb-4'}>
                <Editor
                    style={{ height: '100%' }}
                    childClassName={tw`h-full rounded-md`}
                    filename={filename}
                    initialContent={content}
                    fetchContent={value => {
                        fetchFileContentRef.current = value;
                    }}
                    onContentSaved={onSave}
                />
            </div>
            <div className={'flex justify-end border-t border-neutral-800 p-3'}>
                <button
                    type={'button'}
                    className={'rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-600'}
                    onClick={onSave}
                >
                    Save
                </button>
            </div>
        </div>
    );
};

const FloatingWindowFrame = ({
    win,
    currentServerId,
    onClose,
    onFocus,
    onMove,
    onResize,
    serverRoutes,
}: {
    win: FloatingServerWindow;
    currentServerId: string;
    onClose: (id: string) => void;
    onFocus: (id: string) => void;
    onMove: (id: string, x: number, y: number) => void;
    onResize: (id: string, width: number, height: number) => void;
    serverRoutes: ServerRouteDefinition[];
}) => {
    const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
    const resizeRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        width: number;
        height: number;
    } | null>(null);
    const [floatingFilePath, setFloatingFilePath] = useState<string | null>(null);

    const isFilesWindow = win.routePath.startsWith('files');
    const showFileEditor = isFilesWindow && !!floatingFilePath;

    const onWindowContentClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isFilesWindow) {
            return;
        }

        const target = event.target as HTMLElement;
        const anchor = target.closest('a');

        if (!anchor) {
            return;
        }

        const href = anchor.getAttribute('href');

        if (!href) {
            return;
        }

        const editPrefix = `/server/${win.serverId}/files/edit/`;

        if (href.startsWith(editPrefix)) {
            event.preventDefault();
            event.stopPropagation();

            const encodedPath = href.slice(editPrefix.length);
            setFloatingFilePath(decodeURIComponent(encodedPath));
        }
    };
    const onDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        onFocus(win.id);
        dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - win.x,
            offsetY: event.clientY - win.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
            return;
        }

        const maxX = Math.max(0, window.innerWidth - 160);
        const maxY = Math.max(0, window.innerHeight - 56);
        const x = clamp(event.clientX - dragRef.current.offsetX, 0, maxX);
        const y = clamp(event.clientY - dragRef.current.offsetY, 0, maxY);
        onMove(win.id, x, y);
    };

    const onDragPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
            return;
        }

        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        onFocus(win.id);
        resizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: win.width,
            height: win.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const onResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizeRef.current || resizeRef.current.pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - resizeRef.current.startX;
        const deltaY = event.clientY - resizeRef.current.startY;
        const width = clamp(resizeRef.current.width + deltaX, MIN_WIDTH, window.innerWidth - win.x - 8);
        const height = clamp(resizeRef.current.height + deltaY, MIN_HEIGHT, window.innerHeight - win.y - 8);

        onResize(win.id, width, height);
    };

    const onResizePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizeRef.current || resizeRef.current.pointerId !== event.pointerId) {
            return;
        }

        resizeRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const { headers, background } = useStoreState(state => state.theme.data!.colors);

    return (
        <div
            className={classNames(
                'floating-window-theme absolute overflow-hidden rounded-lg border shadow-2xl',
                win.serverId !== currentServerId && 'border-neutral-500/70',
            )}
            style={{
                left: win.x,
                top: win.y,
                width: win.width,
                height: win.height,
                zIndex: win.zIndex,
                backgroundColor: background,
                borderColor: win.serverId !== currentServerId ? undefined : undefined,
            }}
            onMouseDown={() => onFocus(win.id)}
        >
            <FloatingWindowToolbar
                title={win.title}
                sourceServerId={win.serverId}
                sourceServerName={win.serverName}
                currentServerId={currentServerId}
                onClose={() => onClose(win.id)}
                canGoBack={showFileEditor}
                onBack={() => setFloatingFilePath(null)}
                onDragPointerDown={onDragPointerDown}
                onDragPointerMove={onDragPointerMove}
                onDragPointerUp={onDragPointerUp}
            />
            <div className={'h-[calc(100%-2.5rem)] overflow-auto'} onClickCapture={onWindowContentClickCapture}>
                {showFileEditor ? (
                    <FloatingFileEditor serverUuid={win.serverUuid} filename={floatingFilePath || ''} />
                ) : (
                    <EmbeddedServerView serverRoutes={serverRoutes} routePath={win.routePath} />
                )}
            </div>
            <button
                type={'button'}
                className={'absolute bottom-0 right-0 h-4 w-4 cursor-se-resize'}
                style={{ backgroundColor: headers }}
                aria-label={'Resize floating window'}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
            />
        </div>
    );
};

const FloatingWindowToolbar = ({
    title,
    sourceServerId,
    sourceServerName,
    currentServerId,
    onClose,
    canGoBack,
    onBack,
    onDragPointerDown,
    onDragPointerMove,
    onDragPointerUp,
}: {
    title: string;
    sourceServerId: string;
    sourceServerName: string;
    currentServerId: string;
    onClose: () => void;
    canGoBack: boolean;
    onBack: () => void;
    onDragPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onDragPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onDragPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) => {
    const showExternalServerMessage = sourceServerId !== currentServerId;
    const {
        secondary: _secondary,
        headers: _headers,
        background: _background,
    } = useStoreState(state => state.theme.data!.colors);

    return (
        <div>
            <div
                className={'flex h-10 select-none items-center justify-between px-2'}
                style={{ backgroundColor: _headers }}
            >
                <div
                    className={'flex flex-1 items-center gap-2 overflow-hidden text-sm text-neutral-200'}
                    onPointerDown={onDragPointerDown}
                    onPointerMove={onDragPointerMove}
                    onPointerUp={onDragPointerUp}
                >
                    {canGoBack && (
                        <button
                            type={'button'}
                            className={'rounded p-1 text-neutral-200'}
                            style={{ backgroundColor: _headers }}
                            onPointerDown={event => event.stopPropagation()}
                            onClick={event => {
                                event.stopPropagation();
                                onBack();
                            }}
                        >
                            <ArrowLeftIcon className={'h-4 w-4'} />
                        </button>
                    )}
                    <span className={'truncate font-medium'}>{title}</span>
                    {sourceServerName && (
                        <span className={'truncate text-xs text-neutral-400'}>({sourceServerName})</span>
                    )}
                </div>
                <div className={'flex items-center gap-1'}>
                    <button
                        type={'button'}
                        className={'rounded p-1 text-neutral-200'}
                        style={{ backgroundColor: _headers }}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                            event.stopPropagation();
                            onClose();
                        }}
                    >
                        <XIcon className={'h-4 w-4'} />
                    </button>
                </div>
            </div>
            {showExternalServerMessage && (
                <div className={'border-b px-3 py-1 text-xs text-neutral-300'} style={{ backgroundColor: _background }}>
                    This window belongs to server {sourceServerName || sourceServerId}.
                </div>
            )}
        </div>
    );
};

export default ({ windows, currentServerId, onClose, onFocus, onMove, onResize, serverRoutes }: Props) => {
    const orderedWindows = useMemo(() => [...windows].sort((a, b) => a.zIndex - b.zIndex), [windows]);

    if (!orderedWindows.length) {
        return null;
    }

    return (
        <div className={'pointer-events-none fixed inset-0 z-50'}>
            {orderedWindows.map(win => (
                <Fragment key={win.id}>
                    <div className={'pointer-events-auto'}>
                        <FloatingWindowFrame
                            win={win}
                            currentServerId={currentServerId}
                            onClose={onClose}
                            onFocus={onFocus}
                            onMove={onMove}
                            onResize={onResize}
                            serverRoutes={serverRoutes}
                        />
                    </div>
                </Fragment>
            ))}
        </div>
    );
};
