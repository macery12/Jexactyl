import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ServerContext } from '@/state/server';
import { getServerExtensions, ServerExtension } from '@/api/server/extensions';
import Spinner from '@/elements/Spinner';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faPuzzlePiece,
    faUsers,
    faGamepad,
    faCube,
    faServer,
    faChevronRight,
    faLink,
    faWrench,
    faShieldHalved,
    faTerminal,
    faGlobe,
    faDatabase,
    faChartLine,
    faBell,
    faRobot,
    faCloud,
    faFolder,
    faFile,
    faKey,
    faBolt,
    faCogs,
    faLock,
    faScroll,
} from '@fortawesome/free-solid-svg-icons';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { useStoreState } from '@/state/hooks';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import PageContentBlock from '@/elements/PageContentBlock';

const iconMap: Record<string, typeof faPuzzlePiece> = {
    puzzle: faPuzzlePiece,
    users: faUsers,
    gamepad: faGamepad,
    cube: faCube,
    server: faServer,

    // Extra icons for extension authors.
    discord: faDiscord,
    link: faLink,
    wrench: faWrench,
    shield: faShieldHalved,
    terminal: faTerminal,
    globe: faGlobe,
    database: faDatabase,
    chart: faChartLine,
    bell: faBell,
    robot: faRobot,
    cloud: faCloud,
    folder: faFolder,
    file: faFile,
    key: faKey,
    bolt: faBolt,
    cogs: faCogs,
    lock: faLock,
    scroll: faScroll,
};

export default () => {
    const { id } = useParams<{ id: string }>();
    const [extensions, setExtensions] = useState<ServerExtension[]>([]);
    const [loading, setLoading] = useState(true);
    const { clearAndAddHttpError } = useFlash();
    const primary = useStoreState(state => state.theme.data!.colors.primary);
    const uuid = ServerContext.useStoreState(state => state.server.data?.uuid);

    useEffect(() => {
        if (!uuid) return;

        getServerExtensions(uuid)
            .then(data => setExtensions(data))
            .catch(error => clearAndAddHttpError({ key: 'server:extensions', error }))
            .finally(() => setLoading(false));
    }, [uuid]);

    if (loading) {
        return (
            <PageContentBlock title={'Extensions'}>
                <div className={'flex items-center justify-center py-16'}>
                    <Spinner size={'large'} />
                </div>
            </PageContentBlock>
        );
    }

    if (extensions.length === 0) {
        return (
            <PageContentBlock title={'Extensions'}>
                <FlashMessageRender byKey={'server:extensions'} className={'mb-4'} />
                <div className={'rounded-lg bg-zinc-800 p-8 text-center'}>
                    <FontAwesomeIcon icon={faPuzzlePiece} className={'mb-4 text-4xl text-neutral-600'} />
                    <p className={'text-neutral-400'}>No extensions are available for this server.</p>
                    <p className={'mt-2 text-sm text-neutral-500'}>
                        Extensions are enabled by your hosting provider based on your server type.
                    </p>
                </div>
            </PageContentBlock>
        );
    }

    return (
        <PageContentBlock title={'Extensions'}>
            <FlashMessageRender byKey={'server:extensions'} className={'mb-4'} />
            <div className={'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
                {extensions.map(extension => {
                    const icon = iconMap[extension.icon] || faPuzzlePiece;
                    const extensionPath = `/server/${id}/extensions/${extension.route || extension.id}`;

                    return (
                        <Link
                            key={extension.id}
                            to={extensionPath}
                            className={
                                'group rounded-lg bg-zinc-800 p-6 transition-all duration-200 hover:bg-zinc-700 hover:shadow-lg'
                            }
                        >
                            <div className={'flex items-center justify-between'}>
                                <div className={'flex items-center space-x-4'}>
                                    <div
                                        className={'flex h-12 w-12 items-center justify-center rounded-lg'}
                                        style={{ backgroundColor: `${primary}20` }}
                                    >
                                        <FontAwesomeIcon icon={icon} className={'text-xl'} style={{ color: primary }} />
                                    </div>
                                    <div>
                                        <h3 className={'font-semibold text-white'}>{extension.name}</h3>
                                        <p className={'text-xs text-neutral-400'}>v{extension.version}</p>
                                    </div>
                                </div>
                                <FontAwesomeIcon
                                    icon={faChevronRight}
                                    className={'text-neutral-500 transition-transform group-hover:translate-x-1'}
                                />
                            </div>
                            <p className={'mt-4 text-sm text-neutral-400'}>{extension.description}</p>
                        </Link>
                    );
                })}
            </div>
        </PageContentBlock>
    );
};
