import http from '@/lib/http';

// Per-server databases, backed by the existing client API
// (/api/client/servers/{id}/databases, Fractal collection of DatabaseTransformer
// with an optional `password` include). The password is only present when the
// caller holds `database.view_password` — the transformer nulls the include
// otherwise, so `password` stays null rather than erroring.

export interface ServerDatabase {
    id: string;
    name: string;
    username: string;
    /** Host mask the database accepts connections from ('%' == anywhere). */
    connectionsFrom: string;
    maxConnections: number;
    host: { address: string; port: number };
    password: string | null;
}

/** 'db.host:3306' — the endpoint users paste into a client. */
export function connectionString(database: ServerDatabase): string {
    return `${database.host.address}:${database.host.port}`;
}

/** JDBC URL for the database, embedding the password when it is visible. */
export function jdbcConnectionString(database: ServerDatabase): string {
    const auth = database.password
        ? `${database.username}:${encodeURIComponent(database.password)}`
        : database.username;
    return `jdbc:mysql://${auth}@${connectionString(database)}/${database.name}`;
}

interface RawDatabaseRow {
    attributes: {
        id: string;
        name: string;
        username: string;
        connections_from: string;
        max_connections: number;
        host: { address: string; port: number };
        relationships?: {
            password?: { attributes?: { password?: string } } | null;
        };
    };
}

function mapDatabase(row: RawDatabaseRow): ServerDatabase {
    const a = row.attributes;
    return {
        id: a.id,
        name: a.name,
        username: a.username,
        connectionsFrom: a.connections_from,
        maxConnections: a.max_connections,
        host: { address: a.host?.address ?? '', port: a.host?.port ?? 0 },
        password: a.relationships?.password?.attributes?.password ?? null,
    };
}

// GET /api/client/servers/{id}/databases
export async function getDatabases(server: string): Promise<ServerDatabase[]> {
    const { data } = await http.get(`/api/client/servers/${server}/databases`, {
        params: { include: 'password' },
    });
    return (data.data ?? []).map(mapDatabase);
}

// POST /api/client/servers/{id}/databases
export async function createDatabase(
    server: string,
    input: { name: string; connectionsFrom: string },
): Promise<ServerDatabase> {
    const { data } = await http.post(
        `/api/client/servers/${server}/databases`,
        { database: input.name, remote: input.connectionsFrom },
        { params: { include: 'password' } },
    );
    return mapDatabase(data);
}

// POST /api/client/servers/{id}/databases/{database}/rotate-password
export async function rotateDatabasePassword(server: string, id: string): Promise<ServerDatabase> {
    const { data } = await http.post(`/api/client/servers/${server}/databases/${id}/rotate-password`);
    return mapDatabase(data);
}

// DELETE /api/client/servers/{id}/databases/{database}
export async function deleteDatabase(server: string, id: string): Promise<void> {
    await http.delete(`/api/client/servers/${server}/databases/${id}`);
}
