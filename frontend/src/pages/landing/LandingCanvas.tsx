import { m } from '@/i18n/messages';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/ui/BrandMark';
import type { LandingSection, LandingSectionId } from '@/lib/globals';
import type { BandTone } from './sections/Band';
import Hero from './sections/Hero';
import Features from './sections/Features';
import Pricing from './sections/Pricing';
import Faq from './sections/Faq';
import Testimonials from './sections/Testimonials';
import Custom from './sections/Custom';

interface Props {
    sections: LandingSection[];
    name: string;
    logo?: string | null;
    // When set, the matching section is outlined — used by the admin editor's
    // live preview to highlight the section currently being edited.
    highlightId?: LandingSectionId | null;
}

// Shared renderer for the public landing chrome + sections. Used by both the live
// public page (LandingPage) and the admin editor's live preview, so the two can
// never visually drift apart.
export default function LandingCanvas({ sections, name, logo, highlightId }: Props) {
    const visible = sections
        .filter(s => s.enabled)
        .slice()
        .sort((a, b) => a.order - b.order);

    // Alternate the band tone across content sections (hero is always transparent
    // so it floats on the aurora). Computed up front so the JSX stays declarative.
    let contentIndex = 0;
    const rendered = visible.map(section => {
        const tone: BandTone = section.id !== 'hero' && contentIndex++ % 2 === 1 ? 'raised' : 'base';
        return { section, tone };
    });

    return (
        <div className="bg-aurora min-h-screen">
            <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
                <BrandMark name={name} logo={logo} size="lg" />
                <Link
                    to="/auth/login"
                    className="inline-flex h-10 items-center rounded-lg border border-[var(--color-border-strong)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]"
                >
                    {m['landing.signIn']()}
                </Link>
            </header>

            <main className="w-full">
                {rendered.map(({ section, tone }) => (
                    <div
                        key={`${section.id}-${section.order}`}
                        data-section={section.id}
                        className={cn(
                            'scroll-mt-6',
                            highlightId === section.id &&
                                'rounded-lg outline-2 -outline-offset-2 outline-dashed outline-[var(--brand)]',
                        )}
                    >
                        <SectionRenderer section={section} tone={tone} name={name} />
                    </div>
                ))}
            </main>

            <footer className="border-t border-[var(--color-border)] py-8 text-center text-xs text-[var(--color-ink-faint)]">
                {m['landing.rights']({ year: new Date().getFullYear(), name })}
            </footer>
        </div>
    );
}

function SectionRenderer({ section, tone, name }: { section: LandingSection; tone: BandTone; name: string }) {
    switch (section.id) {
        case 'hero':
            return <Hero data={section.data} name={name} />;
        case 'features':
            return <Features data={section.data} tone={tone} />;
        case 'pricing':
            return <Pricing data={section.data} tone={tone} />;
        case 'faq':
            return <Faq data={section.data} tone={tone} />;
        case 'testimonials':
            return <Testimonials data={section.data} tone={tone} />;
        case 'custom':
            return <Custom data={section.data} tone={tone} />;
        default:
            return null;
    }
}
