import { createContext, useContext } from 'react';
import type { NodeDetail } from '@/api/nodes';

export const NodeContext = createContext<NodeDetail | null>(null);

export function useNode(): NodeDetail {
    const node = useContext(NodeContext);
    if (!node) throw new Error('useNode must be used within a NodeContext provider');
    return node;
}
