import http from '@/api/http';

const extensionId = 'minecraft_player_manager';

const getBasePath = (uuid: string): string => `/api/client/servers/${uuid}/extensions/${extensionId}`;

export interface OnlinePlayer {
    name: string;
    uuid?: string;
}

export interface ServerStatus {
    online: boolean;
    players: {
        online: number;
        max: number;
        list: OnlinePlayer[];
    };
    version: string;
    motd: string;
}

export interface PlayerEntry {
    uuid: string;
    name: string;
    level?: number;
    bypassesPlayerLimit?: boolean;
    source?: string;
    created?: string;
    reason?: string;
    expires?: string;
}

export interface PlayerManagerStatus {
    server: ServerStatus;
    operators: PlayerEntry[];
    whitelist: PlayerEntry[];
    bannedPlayers: PlayerEntry[];
    bannedIps: { ip: string; reason: string; created: string; source: string; expires: string | null }[];
    whitelistEnabled: boolean;
}

export const getPlayerManagerStatus = async (uuid: string): Promise<PlayerManagerStatus> => {
    const { data } = await http.get(getBasePath(uuid));
    // Handle case where API returns nested data structure
    if (data && data.data) {
        return data.data;
    }
    return data;
};

export const setWhitelistEnabled = async (uuid: string, enabled: boolean): Promise<void> => {
    await http.post(`${getBasePath(uuid)}/whitelist`, { enabled });
};

export const addToWhitelist = async (uuid: string, player: string): Promise<void> => {
    await http.put(`${getBasePath(uuid)}/whitelist/${player}`);
};

export const removeFromWhitelist = async (uuid: string, player: string): Promise<void> => {
    await http.delete(`${getBasePath(uuid)}/whitelist/${player}`);
};

export const opPlayer = async (uuid: string, player: string): Promise<void> => {
    await http.put(`${getBasePath(uuid)}/op/${player}`);
};

export const deopPlayer = async (uuid: string, player: string): Promise<void> => {
    await http.delete(`${getBasePath(uuid)}/op/${player}`);
};

export const banPlayer = async (uuid: string, player: string, reason: string): Promise<void> => {
    await http.put(`${getBasePath(uuid)}/ban/${player}`, { reason });
};

export const unbanPlayer = async (uuid: string, player: string): Promise<void> => {
    await http.delete(`${getBasePath(uuid)}/ban/${player}`);
};

export const banIp = async (uuid: string, ip: string, reason: string): Promise<void> => {
    await http.put(`${getBasePath(uuid)}/ban-ip/${ip}`, { reason });
};

export const unbanIp = async (uuid: string, ip: string): Promise<void> => {
    await http.delete(`${getBasePath(uuid)}/ban-ip/${ip}`);
};

export const kickPlayer = async (uuid: string, player: string, reason?: string): Promise<void> => {
    await http.post(`${getBasePath(uuid)}/kick/${player}`, { reason });
};

export const whisperPlayer = async (uuid: string, player: string, message: string): Promise<void> => {
    await http.post(`${getBasePath(uuid)}/whisper/${player}`, { message });
};

export const killPlayer = async (uuid: string, player: string): Promise<void> => {
    await http.post(`${getBasePath(uuid)}/kill/${player}`);
};

// v1.0.1 - Server Version
export interface ServerVersion {
    raw: string;
    major: number;
    minor: number;
    patch: number;
    protocol: number;
    supportsAttributes: boolean;
}

export interface ServerVersionResponse {
    success: boolean;
    version?: ServerVersion;
    error?: string;
}

export const getServerVersion = async (uuid: string): Promise<ServerVersionResponse> => {
    const { data } = await http.get(`${getBasePath(uuid)}/version`);
    return data.data || data;
};

// v1.0.1 - Player Data Types
export interface ItemEnchantment {
    id: string;
    name: string;
    level: number;
    levelRoman: string;
}

export interface ItemDurability {
    current: number;
    max: number;
    percentage: number;
}

export interface InventoryItem {
    id: string;
    displayId: string;
    name: string;
    slot: number;
    count: number;
    damage: number;
    enchantments: ItemEnchantment[];
    storedEnchantments: ItemEnchantment[];
    customName: string | null;
    lore: string[];
    durability: ItemDurability | null;
    contents: InventoryItem[];
}

export interface PlayerArmor {
    helmet: InventoryItem | null;
    chestplate: InventoryItem | null;
    leggings: InventoryItem | null;
    boots: InventoryItem | null;
}

export interface PlayerLocation {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    dimension: string;
    world: string;
}

export interface PlayerStats {
    health: number;
    maxHealth: number;
    food: number;
    saturation: number;
    xpLevel: number;
    xpTotal: number;
    xpProgress: number;
    gamemode: string;
    score: number;
}

export interface PlayerDataResponse {
    success: boolean;
    player?: {
        uuid: string;
        name: string;
    };
    inventory?: InventoryItem[];
    armor?: PlayerArmor;
    offhand?: InventoryItem | null;
    enderChest?: InventoryItem[];
    location?: PlayerLocation;
    stats?: PlayerStats;
    error?: string;
    debug?: {
        allSlots: { slot: number; id: string }[];
        nbtKeys?: string[];
    };
}

export const getPlayerData = async (uuid: string, player: string): Promise<PlayerDataResponse> => {
    const { data } = await http.get(`${getBasePath(uuid)}/player/${player}/data`);
    return data.data || data;
};

// v1.0.1 - Attributes
export interface AttributeInfo {
    id: string;
    name: string;
    default: number;
    min: number;
    max: number;
    description: string;
}

export interface AttributeCategory {
    category: string;
    attributes: AttributeInfo[];
}

export interface AttributesResponse {
    success: boolean;
    attributes?: AttributeCategory[];
    error?: string;
}

export const getAttributes = async (uuid: string): Promise<AttributesResponse> => {
    const { data } = await http.get(`${getBasePath(uuid)}/attributes`);
    return data.data || data;
};

export interface SetAttributeResponse {
    success: boolean;
    attribute?: string;
    value?: number;
    error?: string;
}

export const setAttribute = async (
    uuid: string,
    player: string,
    attribute: string,
    value: number,
): Promise<SetAttributeResponse> => {
    const { data } = await http.post(`${getBasePath(uuid)}/player/${player}/attribute/${attribute}`, { value });
    return data.data || data;
};

export interface ResetAttributeResponse {
    success: boolean;
    attribute?: string;
    defaultValue?: number;
    error?: string;
}

export const resetAttribute = async (
    uuid: string,
    player: string,
    attribute: string,
): Promise<ResetAttributeResponse> => {
    const { data } = await http.delete(`${getBasePath(uuid)}/player/${player}/attribute/${attribute}`);
    return data.data || data;
};
