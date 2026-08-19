/**
 * A trend line for one lane's retained metrics snapshots.
 *
 * Horizon writes a snapshot every five minutes and the health endpoint already
 * carries them; the totals alone cannot tell a lane that processed 200 jobs
 * steadily from one that processed them in a single burst and has been silent
 * since. Deliberately unlabelled and unaxed -- it is a shape, and the numbers
 * next to it are the measurement.
 */
export function Sparkline({
    points,
    className,
    width = 72,
    height = 20,
}: {
    points: number[];
    className?: string;
    width?: number;
    height?: number;
}) {
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
    const path = points
        .map((value, index) => {
            const x = index * step;
            const y = height - 1 - (value / peak) * (height - 2);
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    return (
        <svg width={width} height={height} className={className} aria-hidden="true">
            <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}
