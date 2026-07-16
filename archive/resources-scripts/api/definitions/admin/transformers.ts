import { Allocation, Node } from '@/api/routes/admin/node';
import { Server, ServerVariable } from '@/api/routes/admin/server';
import { FractalResponseData, FractalResponseList } from '@/api/http';
import * as Models from '@definitions/admin/models';
import { Egg, EggVariable } from '@/api/routes/admin/egg';
import { Nest } from '@/api/routes/admin/nest';
import { type Database } from '@definitions/server';
import { WebhookEvent } from '@/api/routes/admin/webhooks';

const isList = (data: FractalResponseList | FractalResponseData): data is FractalResponseList => data.object === 'list';

function transform<T, M = undefined>(
    data: undefined,
    transformer: (callback: FractalResponseData) => T,
    missing?: M,
): undefined;
function transform<T, M>(
    data: FractalResponseData | undefined,
    transformer: (callback: FractalResponseData) => T,
    missing?: M,
): T | M | undefined;
function transform<T, M>(
    data: FractalResponseList | undefined,
    transformer: (callback: FractalResponseData) => T,
    missing?: M,
): T[] | undefined;
function transform<T>(
    data: FractalResponseData | FractalResponseList | undefined,
    transformer: (callback: FractalResponseData) => T,
    missing = undefined,
) {
    if (data === undefined) return undefined;

    if (isList(data)) {
        return data.data.map(transformer);
    }

    return !data ? missing : transformer(data);
}

export default class Transformers {
    static toServer = ({ attributes }: FractalResponseData): Server => {
        const { oom_killer, ...limits } = attributes.limits;
        const { allocations, egg, nest, node, user, variables, databases, product } = attributes.relationships || {};

        return {
            id: attributes.id,
            uuid: attributes.uuid,
            externalId: attributes.external_id,
            identifier: attributes.identifier,
            name: attributes.name,
            description: attributes.description,
            status: attributes.status,
            ownerId: attributes.owner_id,
            nodeId: attributes.node_id,
            allocationId: attributes.allocation_id,
            eggId: attributes.egg_id,
            nestId: attributes.nest_id,
            limits: { ...limits, oomKiller: oom_killer },
            featureLimits: attributes.feature_limits,
            container: attributes.container,
            renewalDate: attributes.renewal_date ? new Date(attributes.renewal_date) : undefined,
            deletionScheduledAt: attributes.deletion_scheduled_at
                ? new Date(attributes.deletion_scheduled_at)
                : undefined,
            deletionCanceledAt: attributes.deletion_canceled_at ? new Date(attributes.deletion_canceled_at) : undefined,
            deletionScheduledBy: attributes.deletion_scheduled_by,
            isDeletionScheduled: attributes.is_deletion_scheduled ?? false,
            billingProductId: attributes.billing_product_id,
            billingDays: attributes.billing_days,
            createdAt: new Date(attributes.created_at),
            updatedAt: new Date(attributes.updated_at),
            relationships: {
                allocations: transform(allocations as FractalResponseList | undefined, this.toAllocation),
                nest: transform(nest as FractalResponseData | undefined, this.toNest),
                egg: transform(egg as FractalResponseData | undefined, this.toEgg),
                node: transform(node as FractalResponseData | undefined, this.toNode),
                user: transform(user as FractalResponseData | undefined, this.toUser),
                variables: transform(variables as FractalResponseList | undefined, this.toServerEggVariable),
                databases: transform(databases as FractalResponseList | undefined, this.toServerDatabase),
                product:
                    product && product.object !== 'null_resource'
                        ? transform(product as FractalResponseData | undefined, this.toProduct)
                        : undefined,
            },
        };
    };

    static toNode = ({ attributes }: FractalResponseData): Node => {
        return {
            id: attributes.id,
            uuid: attributes.uuid,
            isPublic: attributes.public,
            databaseHostId: attributes.database_host_id,
            name: attributes.name,
            description: attributes.description,
            fqdn: attributes.fqdn,
            ports: {
                http: {
                    public: attributes.publicPortHttp,
                    listen: attributes.listenPortHttp,
                },
                sftp: {
                    public: attributes.publicPortSftp,
                    listen: attributes.listenPortSftp,
                },
            },
            scheme: attributes.scheme,
            isBehindProxy: attributes.behindProxy,
            isMaintenanceMode: attributes.maintenance_mode,
            memory: attributes.memory,
            memoryOverallocate: attributes.memory_overallocate,
            disk: attributes.disk,
            diskOverallocate: attributes.disk_overallocate,
            uploadSize: attributes.upload_size,
            daemonBase: attributes.daemonBase,
            createdAt: new Date(attributes.created_at),
            updatedAt: new Date(attributes.updated_at),
            relationships: {},
        };
    };

    static toUserRole = ({ attributes }: FractalResponseData): Models.UserRole => ({
        id: attributes.id,
        name: attributes.name,
        description: attributes.description,
        permissions: attributes.permissions,
        color: attributes.color,
        relationships: {},
    });

    static toAdminRolePermission = ({ attributes }: FractalResponseData): Models.AdminRolePermission => ({
        key: attributes.key,
        description: attributes.description,
    });

    static toApiKey = ({ attributes }: FractalResponseData): Models.ApiKey => ({
        id: attributes.id,
        identifier: attributes.identifier,
        description: attributes.description,
        allowed_ips: attributes.allowed_ips,
        created_at: new Date(attributes.created_at),
        last_used_at: new Date(attributes.last_used_at),
    });

    static toTicket = ({ attributes }: FractalResponseData): Models.Ticket => ({
        id: attributes.id,
        title: attributes.title,
        status: attributes.status,
        priority: attributes.priority ?? 'medium',
        last_reply_at: attributes.last_reply_at ? new Date(attributes.last_reply_at) : null,
        user: attributes.user,
        assigned_to: attributes.assigned_to,
        created_at: new Date(attributes.created_at),
        updated_at: attributes.updated_at ? new Date(attributes.updated_at) : null,
        relationships: {
            messages: transform(attributes.relationships?.messages as FractalResponseList, this.toTicketMessage),
        },
    });

    static toTicketMessage = ({ attributes }: FractalResponseData): Models.TicketMessage => ({
        id: attributes.id,
        message: attributes.message,
        internal_note: Boolean(attributes.internal_note),
        author: attributes.author,
        created_at: new Date(attributes.created_at),
        updated_at: attributes.updated_at ? new Date(attributes.updated_at) : null,
    });

    static toOrder = ({ attributes: data }: FractalResponseData): Models.Order => ({
        id: data.id,
        name: data.name,
        user_id: data.user_id,
        description: data.description,
        total: data.total,
        status: data.status,
        product_id: data.product_id,
        product_name: data.product_name ?? null,
        username: data.username ?? null,
        user_email: data.user_email ?? null,
        egg_id: data.egg_id ?? null,
        type: data.type,
        threat_index: data.threat_index,
        payment_processor: data.payment_processor,
        transaction: data.transaction
            ? {
                  external_id: data.transaction.external_id,
                  capture_id: data.transaction.capture_id ?? null,
                  status: data.transaction.status,
                  amount: data.transaction.amount,
                  currency: data.transaction.currency,
                  payer_id: data.transaction.payer_id ?? null,
                  payer_email: data.transaction.payer_email ?? null,
                  captured_at: data.transaction.captured_at ? new Date(data.transaction.captured_at) : null,
              }
            : null,
        subtotal: data.subtotal ?? null,
        discount: data.discount ?? null,
        billing_days: data.billing_days ?? null,
        coupon_id: data.coupon_id ?? null,
        node_id: data.node_id ?? null,
        final_price: data.final_price ?? null,
        // Legacy fields
        payment_intent_id: data.payment_intent_id,
        paypal_order_id: data.paypal_order_id,
        paypal_capture_id: data.paypal_capture_id,
        paypal_payer_id: data.paypal_payer_id,
        paypal_payer_email: data.paypal_payer_email,
        paypal_status: data.paypal_status,
        paypal_amount: data.paypal_amount,
        paypal_currency: data.paypal_currency,
        paypal_captured_at: data.paypal_captured_at ? new Date(data.paypal_captured_at) : undefined,
        server_id: data.server_id,
        server_uuid: data.server_uuid,
        server_name: data.server_name,
        created_at: new Date(data.created_at),
        updated_at: data.updated_at ? new Date(data.updated_at) : null,
    });

    static toProduct = ({ attributes }: FractalResponseData): Models.Product => ({
        id: attributes.id,
        uuid: attributes.uuid,
        categoryUuid: attributes.category_uuid,
        name: attributes.name,
        icon: attributes.icon,
        price: attributes.price,
        basePrice: attributes.base_price ?? null,
        description: attributes.description,

        limits: {
            cpu: attributes.limits.cpu,
            memory: attributes.limits.memory,
            disk: attributes.limits.disk,
            backup: attributes.limits.backup,
            database: attributes.limits.database,
            allocation: attributes.limits.allocation,
            subdomain: attributes.limits.subdomain ?? null,
        },

        createdAt: new Date(attributes.created_at),
        updatedAt: new Date(attributes.updated_at),

        relationships: {
            category:
                attributes.relationships?.category?.object === 'category'
                    ? this.toCategory(attributes.relationships.category as FractalResponseData)
                    : undefined,
        },
    });

    static toCategory = ({ attributes }: FractalResponseData): Models.Category =>
        ({
            id: attributes.id,
            uuid: attributes.uuid,
            name: attributes.name,
            icon: attributes.icon,
            description: attributes.description,
            visible: attributes.visible,
            nestId: attributes.nest_id,
            eggId: attributes.egg_id,
            allowedEggs: attributes.allowedEggs || [attributes.egg_id],
            allowEggChanges: attributes.allowEggChanges ?? true,
            allowPlanChanges: attributes.allowPlanChanges ?? true,

            createdAt: new Date(attributes.created_at),
            updatedAt: new Date(attributes.updated_at),

            relationships: {
                products: ((attributes.relationships?.products as FractalResponseList | undefined)?.data || []).map(
                    Transformers.toProduct,
                ),
            },
        }) as Models.Category;

    static toCoupon = ({ attributes }: FractalResponseData): Models.Coupon => ({
        id: attributes.id,
        code: attributes.code,
        type: attributes.type,
        value: attributes.value,
        maxUses: attributes.max_uses,
        maxUsesPerUser: attributes.max_uses_per_user,
        minOrderTotal: attributes.min_order_total,
        expiresAt: attributes.expires_at ? new Date(attributes.expires_at) : null,
        isActive: attributes.is_active,
        allowedFor: attributes.allowed_for,
        usageCount: attributes.usage_count,
        createdAt: new Date(attributes.created_at),
        updatedAt: new Date(attributes.updated_at),
    });

    static toUser = ({ attributes }: FractalResponseData): Models.User => {
        return {
            id: attributes.id,
            uuid: attributes.uuid,
            externalId: attributes.external_id,
            username: attributes.username,
            email: attributes.email,
            language: attributes.language,
            admin_role_id: attributes.admin_role_id || null,
            roleName: attributes.role_name,
            state: attributes.state || null,
            isRootAdmin: attributes.root_admin,
            isUsingTwoFactor: attributes['2fa'] || false,
            avatarUrl: attributes.avatar_url,
            emailVerified: attributes.email_verified ?? false,
            createdAt: new Date(attributes.created_at),
            updatedAt: new Date(attributes.updated_at),
            relationships: {
                role: transform(attributes.relationships?.role as FractalResponseData, this.toUserRole) || null,
            },
        };
    };

    static toEgg = ({ attributes }: FractalResponseData): Egg => ({
        id: attributes.id,
        uuid: attributes.uuid,
        nestId: attributes.nest_id,
        author: attributes.author,
        name: attributes.name,
        description: attributes.description,
        features: attributes.features,
        dockerImages: attributes.docker_images,
        fileDenylist: attributes.config?.file_denylist || [],
        forceOutgoingIp: !!attributes.force_outgoing_ip,
        updateUrl: attributes.update_url ?? null,
        configFiles: attributes.config?.files,
        configStartup: attributes.config?.startup,
        configStop: attributes.config?.stop,
        configFrom: attributes.config?.extends,
        startup: attributes.startup,
        copyScriptFrom: attributes.copy_script_from,
        scriptContainer: attributes.script?.container,
        scriptEntry: attributes.script?.entry,
        scriptIsPrivileged: attributes.script?.privileged,
        scriptInstall: attributes.script?.install,
        createdAt: new Date(attributes.created_at),
        updatedAt: new Date(attributes.updated_at),
        relationships: {
            nest: transform(attributes.relationships?.nest as FractalResponseData, this.toNest),
            variables: transform(attributes.relationships?.variables as FractalResponseList, this.toEggVariable),
        },
    });

    static toEggVariable = ({ attributes }: FractalResponseData): EggVariable => ({
        id: attributes.id,
        eggId: attributes.egg_id,
        name: attributes.name,
        description: attributes.description,
        environmentVariable: attributes.env_variable,
        defaultValue: attributes.default_value,
        isUserViewable: attributes.user_viewable,
        isUserEditable: attributes.user_editable,
        fieldType: attributes.field_type || 'text',
        // isRequired: attributes.required,
        rules: attributes.rules,
        createdAt: new Date(attributes.created_at),
        updatedAt: new Date(attributes.updated_at),
        relationships: {},
    });

    static toServerEggVariable = (data: FractalResponseData): ServerVariable => ({
        ...this.toEggVariable(data),
        serverValue: data.attributes.server_value,
    });

    static toAllocation = ({ attributes }: FractalResponseData): Allocation => ({
        id: attributes.id,
        ip: attributes.ip,
        port: attributes.port,
        alias: attributes.alias || null,
        isAssigned: attributes.assigned,
        relationships: {
            node: transform(attributes.relationships?.node as FractalResponseData, this.toNode),
            server: transform(attributes.relationships?.server as FractalResponseData, this.toServer),
        },
        getDisplayText(): string {
            const raw = `${this.ip}:${this.port}`;

            return !this.alias ? raw : `${this.alias} (${raw})`;
        },
    });

    static toNest = ({ attributes }: FractalResponseData): Nest => ({
        id: attributes.id,
        uuid: attributes.uuid,
        author: attributes.author,
        name: attributes.name,
        description: attributes.description,
        createdAt: new Date(attributes.created_at),
        updatedAt: new Date(attributes.updated_at),
        relationships: {
            eggs: transform(attributes.relationships?.eggs as FractalResponseList, this.toEgg),
        },
    });

    static toServerDatabase = ({ attributes }: FractalResponseData): Database => ({
        id: attributes.id,
        name: attributes.name,
        databaseHostId: attributes.database_host_id,
        username: attributes.username,
        connectionString: attributes.remote,
        allowConnectionsFrom: '',
    });

    static toBillingException = ({ attributes }: FractalResponseData): Models.BillingException => ({
        id: attributes.id,
        uuid: attributes.uuid,
        description: attributes.description,
        title: attributes.title,
        exception_type: attributes.exception_type,
        created_at: new Date(attributes.created_at),
        updated_at: new Date(attributes.last_used_at),
    });

    static toWebhookEvent = ({ attributes }: FractalResponseData): WebhookEvent => ({
        id: attributes.id,
        key: attributes.key,
        description: attributes.description,
        enabled: attributes.enabled,
        createdAt: new Date(attributes.created_at),
        updatedAt: attributes.updated_at ? new Date(attributes.updated_at) : null,
    });

    static toServerPreset = ({ attributes }: FractalResponseData): Models.ServerPreset => ({
        id: attributes.id,
        name: attributes.name,
        description: attributes.description,

        cpu: attributes.cpu,
        memory: attributes.memory,
        disk: attributes.disk,

        nest_id: attributes.nest_id,
        egg_id: attributes.egg_id,

        created_at: attributes.created_at,
        updated_at: attributes.updated_at,
    });
}
