import type { Actions } from 'easy-peasy';
import { useStoreActions } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Form, Formik, useFormikContext } from 'formik';
import { useEffect, useState } from 'react';
import { object } from 'yup';
import tw from 'twin.macro';

import type { Egg } from '@/api/routes/admin/egg';
import { getEgg } from '@/api/routes/admin/egg';
import type { WithRelationships } from '@/api/routes/admin';
import type { Server } from '@/api/routes/admin/server';
import { useServerFromRoute } from '@/api/routes/admin/server';
import type { Values } from '@/api/routes/admin/servers/updateServerStartup';
import updateServerStartup from '@/api/routes/admin/servers/updateServerStartup';
import updateServer from '@/api/routes/admin/servers/updateServer';
import EggSelect from '@admin/management/servers/EggSelect';
import NestSelector from '@admin/management/servers/NestSelector';
import FormikSwitch from '@/elements/FormikSwitch';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import AdminBox from '@/elements/AdminBox';
import Field from '@/elements/Field';
import Label from '@/elements/Label';
import type { ApplicationStore } from '@/state';
import { useStoreState } from '@/state/hooks';
import { faLayerGroup, faCogs } from '@fortawesome/free-solid-svg-icons';
import OwnerSelect from '@admin/management/servers/OwnerSelect';

function ServerConfigurationForm({
    selectedEggId,
    egg,
    setEgg,
    server,
}: {
    selectedEggId?: number;
    egg?: WithRelationships<Egg, 'variables'>;
    setEgg: (value: WithRelationships<Egg, 'variables'> | undefined) => void;
    server: Server;
}) {
    const {
        isSubmitting,
        isValid,
        values: { environment },
        setFieldValue,
    } = useFormikContext<Values>();

    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const [nestId, setNestId] = useState<number>(server.nestId);

    // Handle egg changes
    useEffect(() => {
        if (egg === undefined) {
            return;
        }

        if (server.eggId === egg.id) {
            setFieldValue('image', server.container.image);
            setFieldValue('startup', server.container.startup || '');
            return;
        }

        // Whenever the egg is changed, set the server's startup command to the egg's default.
        setFieldValue('image', Object.values(egg.dockerImages)[0] ?? '');
        setFieldValue('startup', '');
    }, [egg, server.eggId, server.container.image, server.container.startup, setFieldValue]);

    return (
        <Form>
            <div className="space-y-4">
                {/* Basic Settings */}
                <AdminBox icon={faCogs} title={'Server Information'} isLoading={isSubmitting}>
                    <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3`}>
                        <Field
                            id={'name'}
                            name={'name'}
                            label={'Server Name'}
                            type={'text'}
                            placeholder={'My Amazing Server'}
                        />
                        <Field id={'externalId'} name={'externalId'} label={'External Identifier'} type={'text'} />
                        <div css={tw`md:col-span-2`}>
                            <OwnerSelect selected={server?.relationships.user} />
                        </div>
                    </div>
                </AdminBox>

                {/* Startup Configuration */}
                <AdminBox title={'Startup Configuration'} icon={faLayerGroup} isLoading={isSubmitting}>
                    <div css={tw`space-y-3`}>
                        <Field
                            id={'startup'}
                            name={'startup'}
                            label={'Startup Command'}
                            type={'text'}
                            description={
                                "Edit your server's startup command here. Available variables: {{SERVER_MEMORY}}, {{SERVER_IP}}, {{SERVER_PORT}}"
                            }
                            placeholder={egg?.startup || ''}
                        />
                        <div>
                            <Label>Default Startup Command</Label>
                            <Input value={egg?.startup || ''} readOnly />
                        </div>
                    </div>
                </AdminBox>

                {/* Service & Image Configuration */}
                <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-4`}>
                    <AdminBox title={'Service'} isLoading={isSubmitting}>
                        <div css={tw`space-y-3`}>
                            <NestSelector selectedNestId={nestId} onNestSelect={setNestId} />
                            <EggSelect nestId={nestId} selectedEggId={selectedEggId} onEggSelect={setEgg} />
                            <div className="rounded border border-neutral-900 bg-neutral-800 p-2 shadow-inner">
                                <FormikSwitch
                                    name={'skipScripts'}
                                    label={'Skip Egg Install Script'}
                                    description={'Soon™'}
                                />
                            </div>
                        </div>
                    </AdminBox>

                    <AdminBox title={'Docker Image'}>
                        <Field id={'image'} name={'image'} label={'Docker Image'} type={'text'} />
                    </AdminBox>
                </div>

                {/* Environment Variables */}
                {egg?.relationships.variables &&
                    egg.relationships.variables.filter(
                        v => Object.keys(environment).find(e => e === v.environmentVariable) !== undefined,
                    ).length > 0 && (
                        <AdminBox title={'Environment Variables'}>
                            <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-3`}>
                                {egg.relationships.variables
                                    ?.filter(
                                        v =>
                                            Object.keys(environment).find(e => e === v.environmentVariable) !==
                                            undefined,
                                    )
                                    .map((v, i) => (
                                        <Field
                                            key={i}
                                            id={`environment.${v.environmentVariable}`}
                                            name={`environment.${v.environmentVariable}`}
                                            label={v.name}
                                            type={'text'}
                                            placeholder={v.defaultValue}
                                            description={v.description}
                                        />
                                    ))}
                            </div>
                        </AdminBox>
                    )}

                <div className="rounded py-2 pr-6 shadow-md" style={{ backgroundColor: secondary }}>
                    <div className="flex flex-row">
                        <Button type="submit" className="ml-auto" disabled={isSubmitting || !isValid}>
                            Save Changes
                        </Button>
                    </div>
                </div>
            </div>
        </Form>
    );
}

export default () => {
    const { data: server, mutate } = useServerFromRoute();
    const { clearFlashes, clearAndAddHttpError } = useStoreActions(
        (actions: Actions<ApplicationStore>) => actions.flashes,
    );
    const [egg, setEgg] = useState<WithRelationships<Egg, 'variables'> | undefined>(undefined);

    useEffect(() => {
        if (!server) {
            return;
        }

        getEgg(server.eggId)
            .then(egg => setEgg(egg))
            .catch(error => console.error(error));
    }, [server?.eggId]);

    if (!server) return null;

    const submit = async (
        values: Values & { name: string; externalId: string; ownerId: number },
        { setSubmitting }: FormikHelpers<Values & { name: string; externalId: string; ownerId: number }>,
    ) => {
        clearFlashes('server');

        try {
            // Update startup configuration
            await updateServerStartup(server.id, {
                startup: values.startup,
                environment: values.environment,
                image: values.image,
                eggId: values.eggId,
                skipScripts: values.skipScripts,
            });

            // Update basic server settings
            await updateServer(server.id, {
                name: values.name,
                externalId: values.externalId,
                ownerId: values.ownerId,
                limits: { ...server.limits, threads: server.limits.threads ?? '' },
                featureLimits: server.featureLimits,
                allocationId: server.allocationId,
                addAllocations: [],
                removeAllocations: [],
            });

            await mutate();
        } catch (error) {
            console.error(error);
            clearAndAddHttpError({ key: 'server', error });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                name: server.name,
                externalId: server.externalId || '',
                ownerId: server.ownerId,
                startup: server.container.startup || '',
                environment: {} as Record<string, any>,
                image: server.container.image,
                eggId: server.eggId,
                skipScripts: false,
            }}
            validationSchema={object().shape({})}
        >
            <ServerConfigurationForm
                selectedEggId={egg?.id ?? server.eggId}
                egg={egg}
                setEgg={setEgg}
                server={server as Server}
            />
        </Formik>
    );
};
