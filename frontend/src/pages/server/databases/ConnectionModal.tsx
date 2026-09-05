import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import {
    rotateDatabasePassword,
    connectionString,
    jdbcConnectionString,
    type ServerDatabase,
} from '@/api/databases';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { CopyField } from '@/components/ui/CopyField';

// Connection details for one database. The password (and therefore the usable
// JDBC string) only renders when the API actually returned it — the transformer
// nulls the include for users without `database.view_password`.
export default function ConnectionModal({
    database,
    onClose,
}: {
    database: ServerDatabase;
    onClose: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const canRotate = can(server.permissions, 'database.update');

    const rotate = useMutation({
        mutationFn: () => rotateDatabasePassword(server.uuid, database.id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.databases.passwordRotated']() });
            qc.invalidateQueries({ queryKey: ['server', server.id, 'databases'] });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.databases.connectionTitle']()}
            description={database.name}
            footer={
                <>
                    {canRotate && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rotate.mutate()}
                            disabled={rotate.isPending}
                            className="mr-auto"
                        >
                            {rotate.isPending ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                            {m['server.databases.rotatePassword']()}
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {m['common.actions.close']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <CopyField label={m['server.databases.endpoint']()} value={connectionString(database)} />
                <CopyField label={m['server.databases.connectionsFrom']()} value={database.connectionsFrom} />
                <CopyField label={m['server.databases.username']()} value={database.username} />
                {database.password && (
                    <CopyField label={m['server.databases.password']()} value={database.password} secret />
                )}
                <CopyField label={m['server.databases.jdbc']()} value={jdbcConnectionString(database)} secret />
            </div>
        </Modal>
    );
}
