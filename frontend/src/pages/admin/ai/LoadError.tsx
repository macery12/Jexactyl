import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';

export function AiLoadError({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-[var(--color-danger)]">{m['common.states.error']()}</p>
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                {m['common.actions.retry']()}
            </Button>
        </div>
    );
}
