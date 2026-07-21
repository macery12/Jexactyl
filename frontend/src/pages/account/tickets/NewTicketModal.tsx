import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createTicket } from '@/api/tickets';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Modal } from '@/components/ui/Modal';
import { Field, Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export function NewTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { push } = useFlashes();
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');

    const reset = () => {
        setTitle('');
        setMessage('');
    };

    const mutation = useMutation({
        mutationFn: () => createTicket({ title: title.trim(), message: message.trim() }),
        onSuccess: ticket => {
            qc.invalidateQueries({ queryKey: ['account', 'tickets'] });
            push({ type: 'success', message: m['tickets.new.created']() });
            reset();
            onClose();
            navigate(`/tickets/${ticket.id}`);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const valid = title.trim().length >= 3 && message.trim().length >= 3;

    const close = () => {
        if (mutation.isPending) return;
        reset();
        onClose();
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title={m['tickets.new.title']()}
            description={m['tickets.new.subtitle']()}
            footer={
                <>
                    <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['tickets.new.submit']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <Field label={m['tickets.new.subjectLabel']()} htmlFor="ticket-title">
                    <Input
                        id="ticket-title"
                        value={title}
                        maxLength={191}
                        placeholder={m['tickets.new.subjectPlaceholder']()}
                        onChange={e => setTitle(e.target.value)}
                    />
                </Field>
                <Field label={m['tickets.new.messageLabel']()} htmlFor="ticket-message">
                    <Textarea
                        id="ticket-message"
                        value={message}
                        rows={6}
                        maxLength={2000}
                        placeholder={m['tickets.new.messagePlaceholder']()}
                        onChange={e => setMessage(e.target.value)}
                    />
                </Field>
            </div>
        </Modal>
    );
}
