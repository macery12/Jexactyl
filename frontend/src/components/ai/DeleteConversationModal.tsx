import { useMutation } from '@tanstack/react-query';
import { m } from '@/i18n/messages';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Shared confirmation for the server and administrator conversation rails.
 *
 * Conversation deletion used to happen immediately and swallowed failures.
 * Keeping the dialog open on failure makes the result unambiguous, while the
 * global error flash gives the same feedback as the panel's other mutations.
 */
export function DeleteConversationModal({
    title,
    onClose,
    onDelete,
}: {
    title: string;
    onClose: () => void;
    onDelete: () => Promise<void>;
}) {
    const push = useFlashes(s => s.push);
    const remove = useMutation({
        mutationFn: onDelete,
        onSuccess: onClose,
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.ai.deleteTitle']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={remove.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => remove.mutate()}
                        disabled={remove.isPending}
                    >
                        {remove.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.ai.deleteSubmit']()}
                    </Button>
                </>
            }
        >
            <p className="break-words text-sm text-[var(--color-ink-muted)]">
                {m['server.ai.deleteBody']({ title })}
            </p>
        </Modal>
    );
}
