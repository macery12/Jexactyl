import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { fetchAllNodes } from './NodeSelect';
import type { Node } from '@/api/routes/admin/node';
import * as nodeApi from '@/api/routes/admin/node';

const makeNode = (id: number, name: string, fqdn: string): Node => ({
    id,
    uuid: `uuid-${id}`,
    isPublic: true,
    databaseHostId: id,
    name,
    description: null,
    fqdn,
    ports: {
        http: { listen: 8080, public: 8080 },
        sftp: { listen: 2022, public: 2022 },
    },
    scheme: 'https',
    isBehindProxy: false,
    isMaintenanceMode: false,
    memory: 0,
    memoryOverallocate: 0,
    disk: 0,
    diskOverallocate: 0,
    uploadSize: 0,
    daemonBase: '/srv/daemon',
    createdAt: new Date(),
    updatedAt: new Date(),
    relationships: {},
});

const mockNodes: Node[] = [makeNode(1, 'Alpha', 'alpha.example.com'), makeNode(2, 'Beta', 'beta.example.com')];
const mockedSearchNodes = vi.spyOn(nodeApi, 'searchNodes');

describe('fetchAllNodes', () => {
    beforeEach(() => {
        mockedSearchNodes.mockResolvedValue(mockNodes);
    });

    afterEach(() => {
        mockedSearchNodes.mockReset();
    });

    it('requests all nodes without filters', async () => {
        const result = await fetchAllNodes();

        expect(mockedSearchNodes).toHaveBeenCalledWith({ filters: {} });
        expect(result).toEqual(mockNodes);
    });
});
