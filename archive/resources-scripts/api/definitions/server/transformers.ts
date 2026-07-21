import { FractalResponseData, FractalResponseList } from '@/api/http';
import * as Models from '@definitions/server/models.d';

export default class Transformers {
    static toServer = ({ attributes: data }: FractalResponseData): Models.Server => ({
        serverOwner: data.server_owner,
        id: data.identifier,
        internalId: data.internal_id,
        groupIds: data.group_ids ?? [],
        uuid: data.uuid,
        name: data.name,
        node: data.node,
        nodeId: data.node_id,
        isNodeUnderMaintenance: data.is_node_under_maintenance,
        isNodeSupercharged: data.is_node_supercharged,
        status: data.status,
        invocation: data.invocation,
        dockerImage: data.docker_image,
        eggId: data.egg_id,
        sftpDetails: {
            ip: data.sftp_details.ip,
            port: data.sftp_details.port,
        },
        description: data.description ? (data.description.length > 0 ? data.description : null) : null,
        limits: { ...data.limits },
        eggFeatures: data.egg_features || [],
        modpacksSupported: data.modpacks_supported || false,
        extensionsEnabled: data.extensions_enabled || false,
        billingProductId: data.billing_product_id,
        billingDays: data.billing_days,
        renewalDate: data.renewal_date ? new Date(data.renewal_date) : undefined,
        deletionScheduledAt: data.deletion_scheduled_at ? new Date(data.deletion_scheduled_at) : undefined,
        deletionCanceledAt: data.deletion_canceled_at ? new Date(data.deletion_canceled_at) : undefined,
        deletionScheduledBy: data.deletion_scheduled_by,
        isDeletionScheduled: data.is_deletion_scheduled ?? false,
        featureLimits: { ...data.feature_limits },
        isTransferring: data.is_transferring,
        variables: ((data.relationships?.variables as FractalResponseList | undefined)?.data || []).map(
            Transformers.toEggVariable,
        ),
        allocations: ((data.relationships?.allocations as FractalResponseList | undefined)?.data || []).map(
            Transformers.toAllocation,
        ),
    });

    static toBackup = ({ attributes }: FractalResponseData): Models.Backup => ({
        uuid: attributes.uuid,
        isSuccessful: attributes.is_successful,
        isLocked: attributes.is_locked,
        name: attributes.name,
        ignoredFiles: attributes.ignored_files,
        checksum: attributes.checksum,
        bytes: attributes.bytes,
        createdAt: new Date(attributes.created_at),
        completedAt: attributes.completed_at ? new Date(attributes.completed_at) : null,
    });

    static toDatabase = ({ attributes }: FractalResponseData): Models.Database => ({
        id: attributes.id,
        name: attributes.name,
        username: attributes.username,
        databaseHostId: attributes.database_host_id,
        connectionString: `${attributes.host.address}:${attributes.host.port}`,
        allowConnectionsFrom: attributes.connections_from,
        password:
            attributes.relationships?.password && 'attributes' in attributes.relationships.password
                ? (attributes.relationships.password as FractalResponseData).attributes.password
                : undefined,
    });

    static toSubuser = (data: FractalResponseData): Models.Subuser => ({
        uuid: data.attributes.uuid,
        username: data.attributes.username,
        email: data.attributes.email,
        image: data.attributes.image,
        twoFactorEnabled: data.attributes['2fa_enabled'],
        createdAt: new Date(data.attributes.created_at),
        permissions: data.attributes.permissions || [],
        can: permission => (data.attributes.permissions || []).indexOf(permission) >= 0,
    });

    static toAllocation = (data: FractalResponseData): Models.Allocation => ({
        id: data.attributes.id,
        ip: data.attributes.ip,
        alias: data.attributes.ip_alias,
        port: data.attributes.port,
        notes: data.attributes.notes,
        isDefault: data.attributes.is_default,
    });

    static toEggVariable = ({ attributes }: FractalResponseData): Models.EggVariable => ({
        name: attributes.name,
        description: attributes.description,
        envVariable: attributes.env_variable,
        defaultValue: attributes.default_value,
        serverValue: attributes.server_value,
        isEditable: attributes.is_editable,
        rules: attributes.rules.split('|'),
    });

    static toFileObject = (data: FractalResponseData): Models.FileObject => ({
        key: `${data.attributes.is_file ? 'file' : 'dir'}_${data.attributes.name}`,
        name: data.attributes.name,
        mode: data.attributes.mode,
        modeBits: data.attributes.mode_bits,
        size: Number(data.attributes.size),
        isFile: data.attributes.is_file,
        isSymlink: data.attributes.is_symlink,
        mimetype: data.attributes.mimetype,
        createdAt: new Date(data.attributes.created_at),
        modifiedAt: new Date(data.attributes.modified_at),

        isArchiveType: function () {
            const lowerName = this.name.toLowerCase();

            const archiveExtensions = [
                '.zip',
                '.7z',
                '.ddup',
                '.rar',
                '.tar',
                '.tar.gz',
                '.tgz',
                '.tar.bz2',
                '.tbz2',
                '.tar.xz',
                '.txz',
                '.tar.zst',
                '.tzst',
                '.tar.lz4',
                '.tlz4',
                '.tar.br',
            ];

            const archiveMimeTypes = [
                'application/vnd.rar',
                'application/x-rar-compressed',
                'application/x-tar',
                'application/x-br',
                'application/x-bzip2',
                'application/gzip',
                'application/x-gzip',
                'application/x-lzip',
                'application/x-sz',
                'application/x-xz',
                'application/zstd',
                'application/zip',
                'application/x-zip-compressed',
                'application/x-7z-compressed',
            ];

            return (
                this.isFile &&
                (archiveExtensions.some(extension => lowerName.endsWith(extension)) ||
                    archiveMimeTypes.indexOf(this.mimetype) >= 0)
            );
        },

        isEditable: function () {
            if (this.isArchiveType() || !this.isFile) return false;

            const matches = ['application/jar', 'application/octet-stream', 'inode/directory', /^image\/(?!svg\+xml)/];

            return matches.every(m => !this.mimetype.match(m));
        },
    });

    static toTask = (data: any): Models.Task => ({
        id: data.id,
        sequenceId: data.sequence_id,
        action: data.action,
        payload: data.payload,
        timeOffset: data.time_offset,
        isQueued: data.is_queued,
        continueOnFailure: data.continue_on_failure,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
    });

    static toSchedule = ({ attributes }: FractalResponseData): Models.Schedule => {
        return {
            id: attributes.id,
            name: attributes.name,
            cron: {
                dayOfWeek: attributes.cron.day_of_week,
                month: attributes.cron.month,
                dayOfMonth: attributes.cron.day_of_month,
                hour: attributes.cron.hour,
                minute: attributes.cron.minute,
            },
            isActive: attributes.is_active,
            isProcessing: attributes.is_processing,
            onlyWhenOnline: attributes.only_when_online,
            lastRunAt: attributes.last_run_at ? new Date(attributes.last_run_at) : null,
            nextRunAt: attributes.next_run_at ? new Date(attributes.next_run_at) : null,
            createdAt: new Date(attributes.created_at),
            updatedAt: new Date(attributes.updated_at),
            // @ts-expect-error this is fine
            tasks: (attributes.relationships?.tasks?.data || []).map((row: any) => this.toTask(row.attributes)),
        };
    };
}
