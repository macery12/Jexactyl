import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { td } from '@/i18n';

type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, string> = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
};

// Reusable themed dialog built on Radix. Overlay + focus trap come for free;
// the panel is themed with the V2 surface/border/radius tokens. Used by every
// create / edit / confirm flow in the admin area.
//
// Dismissal is deliberately NOT free: by default a dialog closes only via the X
// button, its own Cancel action, or a successful submit. Radix's stock behaviour
// (any pointerdown outside + ESC) silently destroyed in-progress forms — a
// portalled Select popover closing onto the overlay was enough to wipe every
// field in the server builder. Pass `dismissible` for lightweight informational
// dialogs where losing state costs nothing.
export function Modal({
    open,
    onClose,
    title,
    description,
    size = 'md',
    dismissible = false,
    footer,
    children,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    size?: Size;
    dismissible?: boolean;
    footer?: React.ReactNode;
    children: React.ReactNode;
}) {
    const block = dismissible ? undefined : (e: Event | KeyboardEvent) => e.preventDefault();

    return (
        <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
                <Dialog.Content
                    onPointerDownOutside={block}
                    onInteractOutside={block}
                    onEscapeKeyDown={block}
                    className={cn(
                        'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
                        'rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl shadow-black/40',
                        'focus:outline-none',
                        SIZE[size],
                    )}
                >
                    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
                        <div className="min-w-0">
                            <Dialog.Title className="text-base font-semibold text-[var(--color-ink)]">{title}</Dialog.Title>
                            {description && (
                                <Dialog.Description className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{description}</Dialog.Description>
                            )}
                        </div>
                        <Dialog.Close
                            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                            aria-label={td('common.actions.close')}
                        >
                            <X className="h-4 w-4" />
                        </Dialog.Close>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

                    {footer && (
                        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">{footer}</div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
