import { ServerPreset } from '@/api/definitions/admin';
import { getServerPreset } from '@/api/routes/admin/servers/presets';
import AdminContentBlock from '@/elements/AdminContentBlock';
import Spinner from '@/elements/Spinner';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ServerPresetDialog from '@admin/management/servers/presets/ServerPresetDialog';
import AdminBox from '@/elements/AdminBox';
import { faChartBar, faCube, faPencilSquare } from '@fortawesome/free-solid-svg-icons';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import { Button } from '@/elements/button';
import { ChevronLeftIcon } from '@heroicons/react/outline';
import DeleteServerPresetDialog from './DeleteServerPresetDialog';

export default () => {
    const [preset, setPreset] = useState<ServerPreset>();
    const params = useParams();

    useEffect(() => {
        getServerPreset(Number(params.id ?? null))
            .then(setPreset)
            .catch(error => console.log(error));
    }, []);

    if (!preset) return <Spinner size={'large'} centered />;

    return (
        <AdminContentBlock title={'New Server'} showFlashKey={'admin:servers:presets'}>
            <div className={`mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center`}>
                <div className={`flex flex-shrink flex-col`} style={{ minWidth: '0' }}>
                    <h2 className={`font-header text-2xl font-medium text-neutral-50`}>{preset.name}</h2>
                    <p
                        className={`hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 md:block`}
                    >
                        {preset.description ?? 'This is a server preset.'}
                    </p>
                </div>
                <div className={`ml-auto flex space-x-3 pl-4`}>
                    <Link to={'/admin/servers/presets'}>
                        <Button.Text>
                            <ChevronLeftIcon className={'mr-1 h-5 w-5'} /> Back
                        </Button.Text>
                    </Link>
                    <ServerPresetDialog preset={preset} />
                    <DeleteServerPresetDialog id={preset.id} />
                </div>
            </div>
            <div className={'grid gap-8 lg:grid-cols-2'}>
                <AdminBox title={'Basic Information'} icon={faPencilSquare} className={'col-span-2'}>
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div>
                            <Label>Preset Name</Label>
                            <Input disabled value={preset.name}></Input>
                        </div>
                        <div>
                            <Label>Preset Description</Label>
                            <Input disabled value={preset.description}></Input>
                        </div>
                        <div>
                            <Label>Created At</Label>
                            <Input disabled value={new Date(preset.created_at).toLocaleString()}></Input>
                        </div>
                    </div>
                </AdminBox>
                <AdminBox title={'Assignment Details'} icon={faCube}>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                            <Label>Nest ID</Label>
                            <Input disabled value={preset.nest_id ?? 'Not Assigned'}></Input>
                        </div>
                        <div>
                            <Label>Egg ID</Label>
                            <Input disabled value={preset.egg_id ?? 'Not Assigned'}></Input>
                        </div>
                    </div>
                </AdminBox>
                <AdminBox title={'Resource Limits'} icon={faChartBar}>
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div>
                            <Label>CPU Limit (%)</Label>
                            <Input disabled value={preset.cpu}></Input>
                        </div>
                        <div>
                            <Label>Memory Limit (MiB)</Label>
                            <Input disabled value={preset.memory}></Input>
                        </div>
                        <div>
                            <Label>Disk Limit (MiB)</Label>
                            <Input disabled value={preset.disk}></Input>
                        </div>
                    </div>
                </AdminBox>
            </div>
        </AdminContentBlock>
    );
};
