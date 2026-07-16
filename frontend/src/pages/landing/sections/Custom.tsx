import type { LandingSectionData } from '@/lib/globals';
import Band, { type BandTone } from './Band';

interface Props {
    data: LandingSectionData;
    tone: BandTone;
}

// Custom content block. Rendered strictly as plain text (whitespace preserved) —
// never as raw HTML — so admin-entered content can never inject markup/scripts.
export default function Custom({ data, tone }: Props) {
    const title = data.title?.trim();
    const body = data.body?.trim();
    if (!title && !body) return null;

    return (
        <Band tone={tone}>
            <div className="mx-auto max-w-2xl text-center">
                {title && <h2 className="mb-4 text-3xl font-bold tracking-tight">{title}</h2>}
                {body && <p className="whitespace-pre-line text-pretty text-[var(--color-ink-muted)]">{body}</p>}
            </div>
        </Band>
    );
}
