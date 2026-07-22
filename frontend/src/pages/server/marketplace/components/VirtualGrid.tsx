import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Spinner } from '@/components/ui/Spinner';
import { m } from '@/i18n';

// Responsive, row-virtualized grid for the marketplace browsers. Only the rows
// intersecting the viewport are mounted, so a result set of thousands of cards
// stays cheap. Column count is derived from the scroll container width via a
// ResizeObserver; infinite loading fires from a near-bottom sentinel row.

function columnsFor(width: number): number {
    if (width < 560) return 1;
    if (width < 900) return 2;
    if (width < 1240) return 3;
    return 4;
}

interface VirtualGridProps<T> {
    items: T[];
    keyFor: (item: T) => string | number;
    renderItem: (item: T) => React.ReactNode;
    rowHeight?: number;
    hasMore: boolean;
    isFetchingNext: boolean;
    onLoadMore: () => void;
    emptyLabel: string;
}

export function VirtualGrid<T>({
    items,
    keyFor,
    renderItem,
    rowHeight = 168,
    hasMore,
    isFetchingNext,
    onLoadMore,
    emptyLabel,
}: VirtualGridProps<T>) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState(4);

    // Track column count off the container width.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => setCols(columnsFor(el.clientWidth));
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const rowCount = Math.ceil(items.length / cols);

    // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual opts out of the react compiler
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 4,
    });

    // Fire load-more when the last row scrolls into (or near) view.
    const virtualRows = rowVirtualizer.getVirtualItems();
    useEffect(() => {
        const last = virtualRows[virtualRows.length - 1];
        if (!last) return;
        if (last.index >= rowCount - 2 && hasMore && !isFetchingNext) {
            onLoadMore();
        }
    }, [virtualRows, rowCount, hasMore, isFetchingNext, onLoadMore]);

    if (items.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center py-16 text-sm text-[var(--color-ink-faint)]">
                {emptyLabel}
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {virtualRows.map(vRow => {
                    const start = vRow.index * cols;
                    const rowItems = items.slice(start, start + cols);
                    return (
                        <div
                            key={vRow.key}
                            data-index={vRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
                        >
                            <div
                                className="grid gap-3 pb-3"
                                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                            >
                                {rowItems.map(item => (
                                    <div key={keyFor(item)}>{renderItem(item)}</div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            {isFetchingNext && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-[var(--color-ink-muted)]">
                    <Spinner className="h-4 w-4" />
                    {m['server.mods.loadingMore']()}
                </div>
            )}
        </div>
    );
}
