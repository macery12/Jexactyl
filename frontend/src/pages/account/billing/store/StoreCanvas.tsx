import { cn } from '@/lib/cn';
import type { StoreSection, StoreSectionId } from '@/lib/globals';
import Hero from './sections/Hero';
import Features from './sections/Features';
import Catalog from './sections/Catalog';
import Custom from './sections/Custom';
import Trust from './sections/Trust';

interface Props {
    sections: StoreSection[];
    // When set, the matching section is outlined — used by the admin editor's
    // live preview to highlight the section currently being edited.
    highlightId?: StoreSectionId | null;
}

// Shared renderer for the storefront sections. Used by both the live store page
// (StorePage) and the admin editor's live preview, so the two can never visually
// drift apart. Unlike the landing canvas the store lives inside the app shell, so
// there is no page chrome — just a stacked column of sections.
export default function StoreCanvas({ sections, highlightId }: Props) {
    const visible = sections
        .filter(s => s.enabled)
        .slice()
        .sort((a, b) => a.order - b.order);

    return (
        <div className="flex flex-col gap-10">
            {visible.map(section => (
                <div
                    key={`${section.id}-${section.order}`}
                    data-section={section.id}
                    className={cn(
                        'scroll-mt-6',
                        highlightId === section.id &&
                            'rounded-lg outline-2 -outline-offset-2 outline-dashed outline-[var(--brand)]',
                    )}
                >
                    <SectionRenderer section={section} />
                </div>
            ))}
        </div>
    );
}

function SectionRenderer({ section }: { section: StoreSection }) {
    switch (section.id) {
        case 'hero':
            return <Hero data={section.data} />;
        case 'features':
            return <Features data={section.data} />;
        case 'catalog':
            return <Catalog data={section.data} />;
        case 'custom':
            return <Custom data={section.data} />;
        case 'trust':
            return <Trust data={section.data} />;
        default:
            return null;
    }
}
