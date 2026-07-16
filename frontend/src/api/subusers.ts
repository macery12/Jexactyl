import http from '@/lib/http';

// Client subuser endpoints (/api/client/servers/{uuid}/users) plus the global
// permission descriptor (/api/client/permissions). Ported from V1's
// routes/server/{subusers,permissions}.ts. Subusers are additional accounts
// granted a scoped set of dotted permissions on a single server.

export interface Subuser {
    uuid: string;
    username: string;
    email: string;
    image: string;
    twoFactorEnabled: boolean;
    permissions: string[];
    createdAt: string;
}

interface FractalSubuser {
    attributes: {
        uuid: string;
        username: string;
        email: string;
        image: string;
        '2fa_enabled': boolean;
        permissions: string[];
        created_at: string;
    };
}

function toSubuser({ attributes: a }: FractalSubuser): Subuser {
    return {
        uuid: a.uuid,
        username: a.username,
        email: a.email,
        image: a.image,
        twoFactorEnabled: a['2fa_enabled'],
        permissions: a.permissions ?? [],
        createdAt: a.created_at,
    };
}

export async function getSubusers(uuid: string): Promise<Subuser[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/users`);
    return (data.data ?? []).map(toSubuser);
}

export async function saveSubuser(
    uuid: string,
    params: { email: string; permissions: string[] },
    subuser?: Subuser,
): Promise<Subuser> {
    const { data } = await http.post(
        `/api/client/servers/${uuid}/users${subuser ? `/${subuser.uuid}` : ''}`,
        params,
    );
    return toSubuser(data);
}

export async function deleteSubuser(uuid: string, userUuid: string): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/users/${userUuid}`);
}

// Grouped permission catalog used to render the permission matrix. Each group
// (control, user, file, …) exposes a description and a map of key → description.
export interface PermissionGroup {
    key: string;
    description: string;
    permissions: { key: string; fullKey: string; description: string }[];
}

interface PermissionPayload {
    [group: string]: {
        description: string;
        keys: { [k: string]: string };
    };
}

export async function getPermissionGroups(): Promise<PermissionGroup[]> {
    const { data } = await http.get('/api/client/permissions');
    const groups = (data.attributes?.permissions ?? {}) as PermissionPayload;

    // The `websocket` pseudo-group is implicit (always granted); V1 hides it.
    return Object.entries(groups)
        .filter(([key]) => key !== 'websocket')
        .map(([key, group]) => ({
            key,
            description: group.description,
            permissions: Object.entries(group.keys).map(([permKey, description]) => ({
                key: permKey,
                fullKey: `${key}.${permKey}`,
                description,
            })),
        }));
}
