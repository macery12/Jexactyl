import Spinner from '@/elements/Spinner';
import AdminBox from '@/elements/AdminBox';
import { useEffect, useState } from 'react';
import { faLayerGroup, faPuzzlePiece, faServer, faUser } from '@fortawesome/free-solid-svg-icons';
import { ExistingData, getExistingData } from '@/api/setup';
import { Alert } from '@/elements/alert';

export default () => {
    const [loading, setLoading] = useState<boolean>(false);
    const [data, setData] = useState<ExistingData>({ nodes: 0, servers: 0, eggs: 0, users: 0 });

    useEffect(() => {
        setLoading(true);

        getExistingData()
            .then(setData)
            .catch(e => console.error(e))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Checking for data</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        We&apos;re checking the database for any old data to migrate.
                    </p>
                </div>
            </div>
            <div className={'grid gap-4 lg:grid-cols-2'}>
                <AdminBox title={'Users'} icon={faUser}>
                    {loading ? <Spinner centered /> : data.users}
                    &nbsp;ready for migration
                </AdminBox>
                <AdminBox title={'Nodes'} icon={faLayerGroup}>
                    {loading ? <Spinner centered /> : data.nodes}
                    &nbsp;ready for migration
                </AdminBox>
                <AdminBox title={'Servers'} icon={faServer}>
                    {loading ? <Spinner centered /> : data.servers}
                    &nbsp;ready for migration
                </AdminBox>
                <AdminBox title={'Eggs'} icon={faPuzzlePiece}>
                    {loading ? <Spinner centered /> : data.eggs}
                    &nbsp;ready for migration
                </AdminBox>
            </div>
            {!loading && data.users === 1 && (
                <Alert type={'warning'}>
                    Expecting to see data from an old installation here? Contact our Discord for support.
                </Alert>
            )}
        </div>
    );
};
