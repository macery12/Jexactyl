import { LanguageDescription } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { faDocker } from '@fortawesome/free-brands-svg-icons';
import { faFireAlt, faInfoCircle, faMicrochip, faShieldAlt, faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { FormikHelpers } from 'formik';
import { Form, Formik, useFormikContext } from 'formik';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import tw from 'twin.macro';
import { object, string } from 'yup';

import { useEggFromRoute } from '@/api/routes/admin/egg';
import updateEgg from '@/api/routes/admin/eggs/updateEgg';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { Editor } from '@/elements/editor';
import Field, { TextareaField } from '@/elements/Field';
import EggDeleteButton from '@admin/service/nests/eggs/EggDeleteButton';
import DockerImageManager from '@admin/service/nests/eggs/DockerImageManager';
import EggExportButton from '@admin/service/nests/eggs/EggExportButton';
import Label from '@/elements/Label';
import FlashMessageRender from '@/elements/FlashMessageRender';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';
import Checkbox from '@/elements/inputs/Checkbox';

const IMPLEMENTED_FEATURE_OPTIONS = [
    { key: 'eula', name: 'EULA Popup', description: 'Prompts users to accept the Minecraft EULA when required.' },
] as const;

const parseDenylist = (value: string): string[] => {
    return value
        .split('\n')
        .map(v => v.trim())
        .filter(v => v.length > 0);
};

const stringifyDenylist = (values: string[]): string => values.join('\n');

const toDockerImages = (value: string): Record<string, string> => {
    const dockerImages: Record<string, string> = {};

    value.split('\n').forEach(v => {
        const parts = v.trim().split('|');
        const image = parts[0] || '';
        if (image.length < 1) {
            return;
        }

        const alias = parts[1] || image;
        dockerImages[alias] = image;
    });

    return dockerImages;
};

function SectionHint({ text }: { text: string }) {
    return <p css={tw`text-xs text-neutral-400 mt-1 mb-4`}>{text}</p>;
}

// ─── Quick Reference ─────────────────────────────────────────────────────────

function QuickReferenceRow() {
    const { data: egg } = useEggFromRoute();

    if (!egg) return null;

    const stats = [
        { label: 'ID', value: String(egg.id) },
        { label: 'UUID', value: egg.uuid, mono: true, truncate: true },
        { label: 'Author', value: egg.author, truncate: true },
        { label: 'Created', value: egg.createdAt.toLocaleString() },
    ];

    return (
        <div css={tw`grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6`}>
            {stats.map(stat => (
                <div key={stat.label} css={tw`rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-3`}>
                    <p css={tw`text-xs uppercase tracking-widest text-neutral-500 mb-1`}>{stat.label}</p>
                    <p
                        css={[
                            tw`text-base text-neutral-100`,
                            stat.mono && tw`font-mono text-sm`,
                            stat.truncate && tw`truncate`,
                        ]}
                    >
                        {stat.value}
                    </p>
                </div>
            ))}
        </div>
    );
}

// ─── Sticky Save Bar ──────────────────────────────────────────────────────────

function StickyActionsBar({ isSubmitting, isValid }: { isSubmitting: boolean; isValid: boolean }) {
    const { data: egg } = useEggFromRoute();
    const navigate = useNavigate();
    const { background } = useStoreState(state => state.theme.data!.colors);

    if (!egg) return null;

    return (
        <div
            css={tw`sticky bottom-0 z-10 border-t border-neutral-700 px-4 xl:px-6 py-3 mb-0 -mx-4 xl:-mx-6`}
            style={{ backgroundColor: background }}
        >
            <div css={tw`flex items-center gap-3`}>
                <EggExportButton className={''} />
                <EggDeleteButton eggId={egg.id} onDeleted={() => navigate('/admin/nests')} />
                <Button type={'submit'} css={tw`ml-auto`} disabled={isSubmitting || !isValid}>
                    Save Changes
                </Button>
            </div>
        </div>
    );
}

// ─── Exported sub-containers (used by other tabs) ─────────────────────────────

export function EggStartupContainer({ className }: { className?: string }) {
    return (
        <AdminBox icon={faTerminal} title={'Startup Command'} css={tw`mb-6`} className={className}>
            <Field id={'startup'} name={'startup'} label={'Startup Command'} type={'text'} css={tw`mb-1`} />
        </AdminBox>
    );
}

export function EggImageContainer() {
    return (
        <AdminBox icon={faDocker} title={'Docker Images'}>
            <DockerImageManager name={'dockerImages'} />
        </AdminBox>
    );
}

export function EggLifecycleContainer() {
    return (
        <AdminBox icon={faFireAlt} title={'Lifecycle'}>
            <Field id={'configStop'} name={'configStop'} label={'Stop Command'} type={'text'} css={tw`mb-4`} />

            <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-6 mb-2`}>
                <label css={tw`flex items-center gap-3`}>
                    <Field
                        type="checkbox"
                        // @ts-expect-error checkbox rendering
                        as={Checkbox}
                        id={'forceOutgoingIp'}
                        name={'forceOutgoingIp'}
                    />
                    <span css={tw`text-sm`}>Force Outgoing IP</span>
                </label>

                <label css={tw`flex items-center gap-3`}>
                    <Field
                        type="checkbox"
                        // @ts-expect-error checkbox rendering
                        as={Checkbox}
                        id={'scriptIsPrivileged'}
                        name={'scriptIsPrivileged'}
                    />
                    <span css={tw`text-sm`}>Install Script Is Privileged</span>
                </label>
            </div>
        </AdminBox>
    );
}

// ─── Process Configuration ────────────────────────────────────────────────────

interface EggProcessSectionProps {
    className?: string;
}

export interface EggProcessContainerRef {
    getStartupConfiguration: () => Promise<string | null>;
    getFilesConfiguration: () => Promise<string | null>;
}

export const EggProcessContainer = forwardRef<any, EggProcessSectionProps>(function EggProcessContainer(
    { className },
    ref,
) {
    const { isSubmitting, values } = useFormikContext<any>();

    let fetchStartupConfiguration: (() => Promise<string>) | null = null;
    let fetchFilesConfiguration: (() => Promise<string>) | null = null;

    useImperativeHandle<EggProcessContainerRef, EggProcessContainerRef>(
        ref,
        () => ({
            getStartupConfiguration: async () => {
                if (fetchStartupConfiguration === null) {
                    return values.configStartup;
                }
                return await fetchStartupConfiguration();
            },

            getFilesConfiguration: async () => {
                if (fetchFilesConfiguration === null) {
                    return values.configFiles;
                }
                return await fetchFilesConfiguration();
            },
        }),
        [fetchStartupConfiguration, fetchFilesConfiguration, values.configStartup, values.configFiles],
    );

    return (
        <AdminBox icon={faMicrochip} title={'Process Configuration'} css={tw`mb-6`} className={className}>
            <SpinnerOverlay visible={isSubmitting} />
            <SectionHint text={'These JSON blocks are used by Wings to detect startup state and parse file updates.'} />

            <div css={tw`grid grid-cols-1 xl:grid-cols-2 gap-5`}>
                <div>
                    <Label css={tw`mb-2 block`}>Startup Configuration</Label>
                    <Editor
                        childClassName={tw`h-40 rounded`}
                        initialContent={values.configStartup}
                        fetchContent={value => {
                            fetchStartupConfiguration = value;
                        }}
                        language={LanguageDescription.of({ name: 'json', support: json() })}
                    />
                </div>

                <div>
                    <Label css={tw`mb-2 block`}>Configuration Files</Label>
                    <Editor
                        childClassName={tw`h-40 rounded`}
                        initialContent={values.configFiles}
                        fetchContent={value => {
                            fetchFilesConfiguration = value;
                        }}
                        language={LanguageDescription.of({ name: 'json', support: json() })}
                    />
                </div>
            </div>
        </AdminBox>
    );
});

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface AboutValues {
    name: string;
    description: string;
    updateUrl: string;
    startup: string;
    configStop: string;
    configStartup: string;
    configFiles: string;
}

interface DockerValues {
    dockerImages: string;
}

interface AdvancedValues {
    forceOutgoingIp: boolean;
    scriptIsPrivileged: boolean;
    features: string[];
    fileDenylistText: string;
}

// ─── Docker Tab ───────────────────────────────────────────────────────────────

export function EggDockerContainer() {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const { data: egg } = useEggFromRoute();
    const { secondary } = useStoreState(state => state.theme.data!.colors);

    if (!egg) return null;

    const submit = async (values: DockerValues, { setSubmitting }: FormikHelpers<DockerValues>) => {
        clearFlashes('egg');

        updateEgg(egg.id, {
            dockerImages: toDockerImages(values.dockerImages),
        })
            .catch(error => {
                clearAndAddHttpError({ key: 'egg', error });
            })
            .then(() => {
                addFlash({ key: 'egg', type: 'success', title: 'Saved', message: 'Docker images saved successfully.' });
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                dockerImages: Object.keys(egg.dockerImages)
                    .map(key => `${egg.dockerImages[key]}|${key}`)
                    .join('\n'),
            }}
            validationSchema={object().shape({
                dockerImages: string().required('At least one docker image is required.'),
            })}
        >
            {({ isSubmitting, isValid }) => (
                <Form>
                    <FlashMessageRender byKey={'egg'} className={'mb-4'} />

                    <AdminBox icon={faDocker} title={'Docker'}>
                        <SectionHint text={'Use compact rows to manage image URL and label pairs.'} />
                        <DockerImageManager name={'dockerImages'} label={'Image URL | Label'} />
                    </AdminBox>

                    <div
                        css={tw`rounded shadow-md px-4 xl:px-5 py-3 mb-16 mt-6`}
                        style={{ backgroundColor: secondary }}
                    >
                        <div css={tw`flex flex-row`}>
                            <Button type={'submit'} css={tw`ml-auto`} disabled={isSubmitting || !isValid}>
                                Save Docker
                            </Button>
                        </div>
                    </div>
                </Form>
            )}
        </Formik>
    );
}

// ─── Advanced Tab ─────────────────────────────────────────────────────────────

export function EggAdvancedContainer() {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const { data: egg } = useEggFromRoute();
    const { secondary } = useStoreState(state => state.theme.data!.colors);

    if (!egg) return null;

    const submit = async (values: AdvancedValues, { setSubmitting }: FormikHelpers<AdvancedValues>) => {
        clearFlashes('egg');

        const persistedFeatures = values.features;

        updateEgg(egg.id, {
            forceOutgoingIp: values.forceOutgoingIp,
            scriptIsPrivileged: values.scriptIsPrivileged,
            features: persistedFeatures,
            fileDenylist: parseDenylist(values.fileDenylistText),
        })
            .catch(error => {
                clearAndAddHttpError({ key: 'egg', error });
            })
            .then(() => {
                addFlash({
                    key: 'egg',
                    type: 'success',
                    title: 'Saved',
                    message: 'Advanced settings saved successfully.',
                });
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                forceOutgoingIp: egg.forceOutgoingIp,
                scriptIsPrivileged: egg.scriptIsPrivileged,
                features: egg.features || [],
                fileDenylistText: stringifyDenylist(egg.fileDenylist || []),
            }}
        >
            {({ isSubmitting, isValid, values, setFieldValue }) => {
                const hasFeature = (feature: string) => values.features.includes(feature);

                const toggleFeature = (feature: string) => {
                    if (hasFeature(feature)) {
                        setFieldValue(
                            'features',
                            values.features.filter(v => v !== feature),
                        );
                        return;
                    }

                    setFieldValue('features', [...values.features, feature]);
                };

                return (
                    <Form>
                        <FlashMessageRender byKey={'egg'} className={'mb-4'} />

                        <AdminBox icon={faShieldAlt} title={'Advanced'} css={tw`mb-6`}>
                            <SectionHint
                                text={'Rarely used controls are grouped here so they do not clutter the About tab.'}
                            />

                            <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-3 mb-6`}>
                                {IMPLEMENTED_FEATURE_OPTIONS.map(feature => (
                                    <button
                                        key={feature.key}
                                        type={'button'}
                                        onClick={() => toggleFeature(feature.key)}
                                        css={tw`text-left rounded border border-neutral-700 hover:border-neutral-500 px-3 py-3 bg-neutral-900`}
                                    >
                                        <div css={tw`text-sm font-medium text-neutral-100`}>{feature.name}</div>
                                        <div css={tw`text-xs text-neutral-400 mt-1`}>{feature.description}</div>
                                        <div
                                            css={tw`text-xs mt-2`}
                                            style={{ color: hasFeature(feature.key) ? '#86efac' : '#fca5a5' }}
                                        >
                                            {hasFeature(feature.key) ? 'Enabled' : 'Disabled'}
                                        </div>
                                    </button>
                                ))}

                                <div css={tw`flex flex-col gap-4 justify-center px-1`}>
                                    <label css={tw`flex items-center gap-3`}>
                                        <Field
                                            type="checkbox"
                                            // @ts-expect-error checkbox rendering
                                            as={Checkbox}
                                            id={'forceOutgoingIp'}
                                            name={'forceOutgoingIp'}
                                        />
                                        <span css={tw`text-sm text-neutral-200`}>Force Outgoing IP</span>
                                    </label>
                                    <label css={tw`flex items-center gap-3`}>
                                        <Field
                                            type="checkbox"
                                            // @ts-expect-error checkbox rendering
                                            as={Checkbox}
                                            id={'scriptIsPrivileged'}
                                            name={'scriptIsPrivileged'}
                                        />
                                        <span css={tw`text-sm text-neutral-200`}>Install Script Is Privileged</span>
                                    </label>
                                </div>
                            </div>

                            <TextareaField
                                id={'fileDenylistText'}
                                name={'fileDenylistText'}
                                label={'File Deny List'}
                                rows={8}
                                placeholder={'One path per line, for example:\nfile1.png\nfile2.txt\nlogs/latest.log'}
                            />
                        </AdminBox>

                        <div
                            css={tw`rounded shadow-md px-4 xl:px-5 py-3 mb-16 mt-6`}
                            style={{ backgroundColor: secondary }}
                        >
                            <div css={tw`flex flex-row`}>
                                <Button type={'submit'} css={tw`ml-auto`} disabled={isSubmitting || !isValid}>
                                    Save Advanced
                                </Button>
                            </div>
                        </div>
                    </Form>
                );
            }}
        </Formik>
    );
}

// ─── About Tab (default export) ───────────────────────────────────────────────

export default function EggSettingsContainer() {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const ref = useRef<EggProcessContainerRef>();
    const { data: egg } = useEggFromRoute();

    if (!egg) return null;

    const submit = async (values: AboutValues, { setSubmitting }: FormikHelpers<AboutValues>) => {
        clearFlashes('egg');

        updateEgg(egg.id, {
            name: values.name,
            description: values.description,
            updateUrl: values.updateUrl || null,
            startup: values.startup,
            configStop: values.configStop,
            configStartup: (await ref.current?.getStartupConfiguration()) ?? values.configStartup,
            configFiles: (await ref.current?.getFilesConfiguration()) ?? values.configFiles,
        })
            .catch(error => {
                clearAndAddHttpError({ key: 'egg', error });
            })
            .then(() => {
                addFlash({
                    key: 'egg',
                    type: 'success',
                    title: 'Saved',
                    message: 'About settings saved successfully.',
                });
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                name: egg.name,
                description: egg.description || '',
                updateUrl: egg.updateUrl || '',
                startup: egg.startup,
                configStop: egg.configStop || '',
                configStartup: JSON.stringify(egg.configStartup, null, '\t') || '',
                configFiles: JSON.stringify(egg.configFiles, null, '\t') || '',
            }}
            validationSchema={object().shape({
                name: string().required().min(1).max(191),
                startup: string().required('Startup command is required.'),
                configStop: string().required('Stop command is required.'),
                updateUrl: string().nullable(),
            })}
        >
            {({ isSubmitting, isValid }) => (
                <Form>
                    <FlashMessageRender byKey={'egg'} className={'mb-4'} />

                    {/* Quick reference stat row */}
                    <QuickReferenceRow />

                    {/* About — two column layout on wide screens */}
                    <AdminBox icon={faInfoCircle} title={'About'} css={tw`mb-6`}>
                        <SectionHint text={'Basic info and commands used most often.'} />

                        <div css={tw`grid grid-cols-1 xl:grid-cols-2 gap-x-8`}>
                            <Field id={'name'} name={'name'} label={'Name'} type={'text'} css={tw`mb-5`} />
                            <Field
                                id={'description'}
                                name={'description'}
                                label={'Description'}
                                type={'text'}
                                css={tw`mb-5`}
                            />
                            <Field
                                id={'configStop'}
                                name={'configStop'}
                                label={'Stop Command'}
                                type={'text'}
                                css={tw`mb-5`}
                            />
                            <Field
                                id={'updateUrl'}
                                name={'updateUrl'}
                                label={'Update URL'}
                                type={'text'}
                                css={tw`mb-5`}
                            />
                        </div>

                        {/* Startup command spans full width */}
                        <Field id={'startup'} name={'startup'} label={'Startup Command'} type={'text'} css={tw`mb-5`} />
                    </AdminBox>

                    {/* Process config editors side-by-side */}
                    <EggProcessContainer ref={ref} />

                    {/* Sticky save / export / delete bar */}
                    <StickyActionsBar isSubmitting={isSubmitting} isValid={isValid} />
                </Form>
            )}
        </Formik>
    );
}
