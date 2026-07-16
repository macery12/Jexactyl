import http from '@/lib/http';

// Account credentials — API keys + SSH keys, backed by the existing V1
// client endpoints under /api/client/account/*. No backend changes; wire
// shapes follow the PterodactylSerializer (collections under data[] with
// `attributes`, single items as bare `{ attributes, meta }`).

// ---- API keys ---------------------------------------------------------------

export interface AccountApiKey {
    identifier: string;
    description: string;
    allowedIps: string[];
    createdAt: string | null;
    lastUsedAt: string | null;
}

function toApiKey(row: { attributes: Record<string, any> }): AccountApiKey {
    const a = row.attributes;
    return {
        identifier: a.identifier,
        description: a.description ?? '',
        allowedIps: a.allowed_ips ?? [],
        createdAt: a.created_at ?? null,
        lastUsedAt: a.last_used_at ?? null,
    };
}

// GET /api/client/account/api-keys — all keys owned by the current user.
export async function getApiKeys(): Promise<AccountApiKey[]> {
    const { data } = await http.get('/api/client/account/api-keys');
    return (data.data ?? []).map(toApiKey);
}

// POST /api/client/account/api-keys — create a key. The full secret token is
// returned exactly once as `identifier + meta.secret_token`; it can never be
// recovered afterwards.
export async function createApiKey(
    description: string,
    allowedIps: string[],
): Promise<{ key: AccountApiKey; token: string }> {
    const { data } = await http.post('/api/client/account/api-keys', {
        description,
        allowed_ips: allowedIps,
    });
    const key = toApiKey(data);
    return { key, token: `${key.identifier}${data.meta?.secret_token ?? ''}` };
}

// DELETE /api/client/account/api-keys/{identifier} — revoke a key.
export async function deleteApiKey(identifier: string): Promise<void> {
    await http.delete(`/api/client/account/api-keys/${identifier}`);
}

// ---- SSH keys ---------------------------------------------------------------

export interface AccountSshKey {
    name: string;
    publicKey: string;
    fingerprint: string;
    createdAt: string;
}

function toSshKey(row: { attributes: Record<string, any> }): AccountSshKey {
    const a = row.attributes;
    return {
        name: a.name,
        publicKey: a.public_key,
        fingerprint: a.fingerprint,
        createdAt: a.created_at,
    };
}

// GET /api/client/account/ssh-keys — all SSH keys owned by the current user.
export async function getSshKeys(): Promise<AccountSshKey[]> {
    const { data } = await http.get('/api/client/account/ssh-keys');
    return (data.data ?? []).map(toSshKey);
}

// POST /api/client/account/ssh-keys — register a public key.
export async function createSshKey(name: string, publicKey: string): Promise<AccountSshKey> {
    const { data } = await http.post('/api/client/account/ssh-keys', { name, public_key: publicKey });
    return toSshKey(data);
}

// POST /api/client/account/ssh-keys/remove — delete by fingerprint (matches V1;
// there is no DELETE verb for SSH keys).
export async function deleteSshKey(fingerprint: string): Promise<void> {
    await http.post('/api/client/account/ssh-keys/remove', { fingerprint });
}
