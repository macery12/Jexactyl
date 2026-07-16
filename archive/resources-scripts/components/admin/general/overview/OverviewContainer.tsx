import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import AdminContentBlock from '@/elements/AdminContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import {
    faArrowRight,
    faDesktop,
    faHeart,
    faLayerGroup,
    faQuestionCircle,
    faServer,
    faTicket,
    faUserPlus,
    IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import AdminBox from '@/elements/AdminBox';
import Spinner from '@/elements/Spinner';
import CopyOnClick from '@/elements/CopyOnClick';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Link } from 'react-router-dom';
import { Alert } from '@/elements/alert';
import getMetrics, { MetricData } from '@/api/routes/admin/getMetrics';
import getVersion, { VersionData } from '@/api/routes/admin/getVersion';

interface SuggestionProps {
    icon: IconDefinition;
    title: string;
    description: string;
    link: string;
    action?: string;
}

const Code = ({ children }: { children: ReactNode }) => {
    return (
        <code css={tw`text-sm font-mono bg-neutral-900 rounded`} style={{ padding: '2px 6px' }}>
            {children}
        </code>
    );
};

const SuggestionCard = ({ icon, title, description, link, action }: SuggestionProps) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div className={'rounded-lg bg-black/25 p-3 lg:p-6'}>
            <h1 className={'mb-2 text-xl font-semibold'}>
                <FontAwesomeIcon icon={icon} /> {title}
            </h1>
            <p className={'text-gray-300'}>{description}</p>
            <p className={'mt-2 text-right text-sm'} style={{ color: colors.primary }}>
                <Link to={link}>
                    {action ?? 'Manage'} <FontAwesomeIcon icon={faArrowRight} />
                </Link>
            </p>
        </div>
    );
};

export default () => {
    const [loading, setLoading] = useState<boolean>(true);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const everest = useStoreState(state => state.everest.data!);
    const settings = useStoreState(state => state.settings.data!);

    const [metricData, setMetricData] = useState<MetricData | undefined>(undefined);
    const [versionData, setVersionData] = useState<VersionData | undefined>(undefined);

    useEffect(() => {
        clearFlashes('overview');

        getVersion()
            .then(versionData => setVersionData(versionData))
            .catch(error => {
                clearAndAddHttpError({ key: 'overview', error });
            })
            .then(() => setLoading(false));

        getMetrics()
            .then(metricData => setMetricData(metricData))
            .catch(error => {
                clearAndAddHttpError({ key: 'overview', error });
            });
    }, []);

    return (
        <AdminContentBlock title={'Overview'}>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-8`}>
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>Overview</h2>
                    <p
                        css={tw`hidden md:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        A quick glance at your system.
                    </p>
                </div>
            </div>

            <FlashMessageRender byKey={'overview'} css={tw`mb-4`} />

            <AdminBox title={'Version Information'} icon={faDesktop}>
                {settings.debug && (
                    <Alert type={'warning'} className={'mb-3'}>
                        M12Labs is running in debug mode. Do not use in production.
                    </Alert>
                )}
                {loading ? (
                    <Spinner size={'large'} centered />
                ) : (
                    <>
                        <div className={'mb-2 text-gray-200'}>
                            You are currently running version&nbsp;
                            <CopyOnClick text={versionData?.panel.current}>
                                <Code>{versionData?.panel.current}</Code>
                            </CopyOnClick>.
                        </div>
                        {versionData?.panel.current.startsWith('v4.0.0-') && (
                            <Alert type={'danger'} className={'mt-4'}>
                                You are running a beta release of M12Labs v4, which may include several bugs or weird
                                glitches. Do NOT use this software in production unless you don&apos;t care about losing
                                data.
                            </Alert>
                        )}
                    </>
                )}
            </AdminBox>
            <AdminBox title={'Suggested Actions'} className={'mt-6'} icon={faQuestionCircle}>
                <div className={'grid gap-2 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
                    {!everest.auth.registration.enabled && (
                        <SuggestionCard
                            icon={faUserPlus}
                            link={'/admin/auth'}
                            title={'Allow email registration'}
                            description={'Enabling email registration allows users to signup via the login page.'}
                        />
                    )}
                    {metricData && (
                        <>
                            {metricData.nodes < 1 && (
                                <SuggestionCard
                                    icon={faLayerGroup}
                                    link={'/admin/nodes/new'}
                                    title={'Add your first node'}
                                    description={"Nodes are physical servers which M12Labs' servers run on."}
                                />
                            )}
                            {metricData.servers < 1 && (
                                <SuggestionCard
                                    icon={faServer}
                                    link={'/admin/servers/new'}
                                    title={'Create your first server'}
                                    description={'Create a server to host your favourite game or program.'}
                                />
                            )}
                            {everest.tickets.enabled && metricData.tickets > 0 && (
                                <SuggestionCard
                                    icon={faTicket}
                                    link={'/admin/tickets'}
                                    title={'Answer customer tickets'}
                                    description={`You currently have ${metricData.tickets} pending tickets.`}
                                />
                            )}
                        </>
                    )}
                    <SuggestionCard
                        icon={faHeart}
                        link={'https://donate.stripe.com/4gM4gzeoYeSk5dyd4T5ZC02'}
                        title={'Support M12Labs Development'}
                        action={'Donate'}
                        description={
                            'Help fund infrastructure, development time, and new features to keep M12Labs fast, reliable, and actively maintained.'
                        }
                    />
                    <SuggestionCard
                        icon={faHeart}
                        link={'https://donate.stripe.com/6oE02Zftd9cC34IbIS'}
                        title={'Support the original creators'}
                        action={'Donate'}
                        description={
                            'Jexpanel laid the groundwork for M12Labs. If you value what we’ve built, consider giving back to the project that made it possible.'
                        }
                    />
                </div>
            </AdminBox>
        </AdminContentBlock>
    );
};
