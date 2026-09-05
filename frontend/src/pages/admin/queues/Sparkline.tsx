import { useId } from 'react';

/**
 * A trend line for one lane's retained metrics snapshots.
 *
 * Horizon writes a snapshot every five minutes and the health endpoint already
 * carries them; the totals alone cannot tell a lane that processed 200 jobs
 * steadily from one that processed them in a single burst and has been silent
 * since. Deliberately unlabelled and unaxed -- it is a shape, and the numbers
 * next to it are the measurement.
 *
 * `area` fills under the line and marks the latest point. Reserved for the lane
 * cards, where the chart is the reason the card exists; the inline trend cells
 * stay a bare line so a table of them does not turn into wallpaper.
 */
export function Sparkline({
    points,
    className,
    width = 72,
    height = 20,
    area = false,
}: {
    points: number[];
    className?: string;
    width?: number;
    height?: number;
    area?: boolean;
}) {
    // Unique per instance: two charts on one page would otherwise share a
    // gradient id, and the second would render with the first one's fill.
    const gradientId = useId();

    // One point cannot make a line, and an all-zero series would divide by zero
    // below. Both render as a flat baseline, which reads correctly as "nothing".
    const peak = Math.max(0, ...points);

    if (points.length < 2 || peak === 0) {
        return (
            <svg width={width} height={height} className={className} aria-hidden="true">
                <line
                    x1={0}
                    y1={height - 1}
                    x2={width}
                    y2={height - 1}
                    stroke="currentColor"
                    strokeWidth={1}
                    opacity={0.25}
                />
            </svg>
        );
    }

    // Inset by a pixel top and bottom so a peak or a trough is not clipped by
    // the viewport edge.
    const step = width / (points.length - 1);
    const coords = points.map((value, index) => ({
        x: index * step,
        y: height - 1 - (value / peak) * (height - 2),
    }));

    const path = coords
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');

    // Guaranteed by the two-point guard above; narrowed for the compiler.
    const last = coords[coords.length - 1] ?? { x: width, y: height - 1 };

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className={className}
            aria-hidden="true"
        >
            {area && (
                <>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${gradientId})`} stroke="none" />
                </>
            )}
            <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
            {area && <circle cx={last.x} cy={last.y} r={2} fill="currentColor" />}
        </svg>
    );
}
