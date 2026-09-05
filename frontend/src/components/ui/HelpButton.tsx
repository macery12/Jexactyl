import { useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { td } from '@/i18n/messages';

// A small "?" help affordance for a page header. Opens a themed modal with a
// free-form guide (passed as children). Kept generic so any page can drop in a
// plain-language walkthrough — used by the custom-domains pages, which are a
// mildly confusing, operator-facing feature.
export function HelpButton({
    title,
    label,
    children,
    size = 'lg',
}: {
    title: string;
    label: string;
    children: ReactNode;
    size?: 'sm' | 'md' | 'lg';
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={label}
                title={label}
                onClick={() => setOpen(true)}
            >
                <HelpCircle className="h-4 w-4" />
            </Button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={title}
                size={size}
                footer={
                    <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                        {td('common.actions.close')}
                    </Button>
                }
            >
                {children}
            </Modal>
        </>
    );
}

// Structured "numbered steps / sections" body for a HelpButton. Each entry is a
// heading + body; renders as an ordered guide with themed number chips.
export function HelpSteps({ steps }: { steps: { title: string; body: ReactNode }[] }) {
    return (
        <ol className="flex flex-col gap-5">
            {steps.map((step, i) => (
                <li key={i} className="flex gap-3.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                        {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[var(--color-ink)]">{step.title}</h3>
                        <div className="mt-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">{step.body}</div>
                    </div>
                </li>
            ))}
        </ol>
    );
}
