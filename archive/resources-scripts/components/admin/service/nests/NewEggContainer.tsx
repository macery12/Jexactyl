import type { FormikHelpers } from 'formik';
import { Form, Formik } from 'formik';
import { useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import tw from 'twin.macro';
import { array, object, string } from 'yup';

import createEgg from '@/api/routes/admin/eggs/createEgg';
import AdminContentBlock from '@/elements/AdminContentBlock';
import type { EggProcessContainerRef } from '@admin/service/nests/eggs/EggSettingsContainer';
import {
    EggImageContainer,
    EggLifecycleContainer,
    EggProcessContainer,
    EggStartupContainer,
} from '@admin/service/nests/eggs/EggSettingsContainer';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import Field from '@/elements/Field';

interface Values {
    name: string;
    description: string;
    startup: string;
    dockerImages: string;
    configStop: string;
    configStartup: string;
    configFiles: string;
    updateUrl: string;
    features: string[];
    fileDenylist: string[];
    forceOutgoingIp: boolean;
    scriptContainer: string;
    scriptEntry: string;
    scriptInstall: string;
    scriptIsPrivileged: boolean;
}

function EggSelectionContainer() {
    return (
        <AdminBox title={'Egg Details'} css={tw`mb-6`}>
            <Field id={'name'} name={'name'} label={'Name'} type={'text'} css={tw`mb-6`} />
            <Field id={'description'} name={'description'} label={'Description'} type={'text'} css={tw`mb-6`} />
        </AdminBox>
    );
}

export default function NewEggContainer() {
    const navigate = useNavigate();
    const params = useParams<{ nestId: string }>();

    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const ref = useRef<EggProcessContainerRef>();

    const submit = async (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes('egg:create');

        const nestId = Number(params.nestId);

        values.configStartup = (await ref.current?.getStartupConfiguration()) || values.configStartup;
        values.configFiles = (await ref.current?.getFilesConfiguration()) || values.configFiles;

        const dockerImages: Record<string, string> = {};
        values.dockerImages.split('\n').forEach(v => {
            const parts = v.trim().split('|');
            const image = parts[0] || '';
            if (image.length < 1) {
                return;
            }

            const alias = parts[1] || image;
            dockerImages[alias] = image;
        });

        createEgg({
            ...values,
            dockerImages,
            nestId,
            updateUrl: values.updateUrl || null,
        })
            .then(egg => navigate(`/admin/nests/${nestId}/eggs/${egg.id}`))
            .catch(error => {
                clearAndAddHttpError({ key: 'egg:create', error });
            })
            .then(() => setSubmitting(false));
    };

    return (
        <AdminContentBlock title={'New Egg'}>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-8`}>
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>New Egg</h2>
                    <p css={tw`hidden md:block text-base text-neutral-400`}>
                        Create an egg with a simple, single-page form.
                    </p>
                </div>
            </div>

            <FlashMessageRender key={'egg:create'} css={tw`mb-4`} />

            <Formik
                onSubmit={submit}
                initialValues={{
                    name: '',
                    description: '',
                    startup: '',
                    dockerImages: '',
                    configStop: 'stop',
                    configStartup: JSON.stringify({ done: [], strip_ansi: false, user_interaction: [] }, null, 2),
                    configFiles: '{}',
                    updateUrl: '',
                    features: [],
                    fileDenylist: [],
                    forceOutgoingIp: false,
                    scriptContainer: 'ghcr.io/pterodactyl/installers:debian',
                    scriptEntry: '/bin/bash',
                    scriptInstall: '',
                    scriptIsPrivileged: false,
                }}
                validationSchema={object().shape({
                    name: string().required('An egg name is required.').min(1).max(191),
                    startup: string().required('A startup command is required.'),
                    dockerImages: string()
                        .required('At least one Docker image is required.')
                        .test('valid-images', 'Each line must be in image|alias format.', value =>
                            (value || '')
                                .split('\n')
                                .filter(l => l.trim().length > 0)
                                .every(l => l.includes('|') && l.split('|')[0].trim().length > 0),
                        ),
                    configStop: string().required('A stop command is required.'),
                    features: array().of(string()),
                })}
            >
                {({ isSubmitting, isValid }) => (
                    <Form>
                        <EggSelectionContainer />

                        <EggStartupContainer css={tw`mb-6`} />

                        <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 mb-6`}>
                            <EggImageContainer />
                            <EggLifecycleContainer />
                        </div>

                        <EggProcessContainer ref={ref} css={tw`mb-6`} />

                        <div css={tw`bg-zinc-800 rounded shadow-md py-2 px-6 mb-16`}>
                            <div css={tw`flex flex-row`}>
                                <Button type="submit" css={tw`ml-auto`} disabled={isSubmitting || !isValid}>
                                    Create Egg
                                </Button>
                            </div>
                        </div>
                    </Form>
                )}
            </Formik>
        </AdminContentBlock>
    );
}
