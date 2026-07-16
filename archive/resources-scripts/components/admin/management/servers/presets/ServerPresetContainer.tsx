import { SubNavigation, SubNavigationLink } from '@/components/admin/SubNavigation';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { AdjustmentsIcon, TerminalIcon } from '@heroicons/react/outline';
import ServerPresetsTable from './ServerPresetsTable';
import ServerPresetDialog from './ServerPresetDialog';

export default () => (
    <AdminContentBlock title={'New Server'} showFlashKey={'admin:servers:presets'}>
        <div className={`mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center`}>
            <div className={`flex flex-shrink flex-col`} style={{ minWidth: '0' }}>
                <h2 className={`font-header text-2xl font-medium text-neutral-50`}>Server Presets</h2>
                <p
                    className={`hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 md:block`}
                >
                    Control preset server configurations for administrators.
                </p>
            </div>
            <div className={`ml-auto flex pl-4`}>
                <ServerPresetDialog />
            </div>
        </div>

        <SubNavigation>
            <SubNavigationLink to="/admin/servers" name="All Servers" base>
                <TerminalIcon />
            </SubNavigationLink>
            <SubNavigationLink to="/admin/servers/presets" name="Presets">
                <AdjustmentsIcon />
            </SubNavigationLink>
        </SubNavigation>

        <ServerPresetsTable />
    </AdminContentBlock>
);
