import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';

interface Props {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    label?: string;
}

export default function ToggleSwitch({ checked, onChange, disabled, label }: Props) {
    const theme = useStoreState(s => s.theme.data!);

    return (
        <button
            type={'button'}
            onClick={onChange}
            disabled={disabled}
            aria-label={label}
            className={classNames(
                'relative inline-flex h-8 w-16 flex-shrink-0 items-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900',
                checked ? 'bg-primary-500/80' : '',
                disabled && 'cursor-not-allowed opacity-50',
            )}
            style={{
                borderColor: theme.colors.headers,
                backgroundColor: checked ? undefined : theme.colors.secondary,
            }}
        >
            <span
                className={classNames(
                    'inline-block h-6 w-6 transform rounded-full bg-neutral-100 shadow transition',
                    checked ? 'translate-x-8' : 'translate-x-1',
                )}
            />
        </button>
    );
}
