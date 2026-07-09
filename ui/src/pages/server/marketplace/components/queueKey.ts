// Shared query key for the download queue so the header badge poll, the Queue
// tab, and post-download invalidation all stay in sync.
export const queueKey = (serverId: string) => ['modQueue', serverId] as const;
