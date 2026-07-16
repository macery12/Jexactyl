import { useStoreActions } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Form, Formik } from 'formik';
import tw from 'twin.macro';
import { object } from 'yup';

import { useServerFromRoute } from '@/api/routes/admin/server';
import type { Values } from '@/api/routes/admin/servers/updateServer';
import updateServer from '@/api/routes/admin/servers/updateServer';
import FeatureLimitsBox from '@admin/management/servers/settings/FeatureLimitsBox';
import ServerResourceBox from '@admin/management/servers/settings/ServerResourceBox';
import NetworkingBox from '@admin/management/servers/settings/NetworkingBox';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';

export default () => {
    const { data: server, mutate } = useServerFromRoute();
    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const { clearFlashes, clearAndAddHttpError } = useStoreActions(actions => actions.flashes);

    if (!server) return null;

    const submit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes('server');

        updateServer(server.id, values)
            .then(() => {
                mutate();
            })
            .catch(error => {
                console.error(error);
                clearAndAddHttpError({ key: 'server', error });
            })
            .finally(() => setSubmitting(false));
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                externalId: server.externalId || '',
                name: server.name,
                ownerId: server.ownerId,
                limits: {
                    memory: server.limits.memory,
                    swap: server.limits.swap,
                    disk: server.limits.disk,
                    io: server.limits.io,
                    cpu: server.limits.cpu,
                    threads: server.limits.threads || '',
                    oomKiller: server.limits.oomKiller,
                },
                featureLimits: {
                    allocations: server.featureLimits.allocations,
                    backups: server.featureLimits.backups,
                    databases: server.featureLimits.databases,
                    subusers: server.featureLimits.subusers,
                    subdomains: server.featureLimits.subdomains,
                },
                allocationId: server.allocationId,
                addAllocations: [] as number[],
                removeAllocations: [] as number[],
            }}
            validationSchema={object().shape({})}
        >
            {({ isSubmitting, isValid }) => (
                <Form>
                    {/* Network & Allocations */}
                    <div css={tw`mb-4`}>
                        <NetworkingBox />
                    </div>

                    {/* Resource Limits */}
                    <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-6 mb-4`}>
                        <ServerResourceBox />
                        <FeatureLimitsBox />
                    </div>

                    <div style={{ backgroundColor: secondary }} css={tw`rounded shadow-md px-4 xl:px-5 py-3`}>
                        <div css={tw`flex flex-row justify-end`}>
                            <Button type="submit" disabled={isSubmitting || !isValid}>
                                Save Changes
                            </Button>
                        </div>
                    </div>
                </Form>
            )}
        </Formik>
    );
};
