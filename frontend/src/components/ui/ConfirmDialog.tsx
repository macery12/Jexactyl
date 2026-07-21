import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Switch } from './Switch';
import { Spinner } from './Spinner';

// Destructive-confirm wrapper over Modal. Optional `force` switch surfaces a
// boolean to the confirm handler (used by force-delete server). Strings are
// passed in so the catalog stays at the call site.
export function ConfirmDialog({
    open,
    onClose,
    title,
    body,
    confirmLabel,
    cancelLabel,
    danger = true,
    busy,
    force,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    body: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
    busy?: boolean;
    force?: { label: string };
    onConfirm: (force: boolean) => void;
}) {
    const [forced, setForced] = useState(false);

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                        {cancelLabel}
                    </Button>
                    <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={() => onConfirm(forced)} disabled={busy}>
                        {busy && <Spinner className="h-4 w-4" />}
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-[var(--color-ink-muted)]">{body}</p>
            {force && (
                <label className="mt-4 flex items-center gap-3 text-sm text-[var(--color-ink)]">
                    <Switch checked={forced} onChange={setForced} disabled={busy} />
                    {force.label}
                </label>
            )}
        </Modal>
    );
}
