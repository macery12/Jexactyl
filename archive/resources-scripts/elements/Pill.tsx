import { ReactNode } from 'react';
import classNames from 'classnames';

export type PillSize = 'normal' | 'large' | 'small' | 'xsmall';
export type PillStatus = 'success' | 'info' | 'warn' | 'danger' | 'unknown';

function getColor(type?: PillStatus): string {
    let value = 'bg-gray-600 text-gray-200';

    switch (type) {
        case 'success':
            value = 'bg-green-100 text-green-800';
            break;
        case 'info':
            value = 'bg-blue-100 text-blue-800';
            break;
        case 'warn':
            value = 'bg-yellow-100 text-yellow-800';
            break;
        case 'danger':
            value = 'bg-red-100 text-red-800';
            break;
        case 'unknown':
            value = 'bg-black/50';
            break;
        default:
            break;
    }

    return value;
}

export default ({ type, size, children }: { type?: PillStatus; size?: PillSize; children: ReactNode }) => (
    <span
        className={classNames(
            getColor(type),
            !size && 'rounded-full px-2 text-xs',
            size === 'large' && 'w-full rounded-lg px-6 py-4',
            size === 'small' && 'rounded-full px-3 py-0.5 text-sm',
            size === 'xsmall' && 'rounded-full px-1 text-2xs',
            'relative mx-1 inline-flex font-medium capitalize leading-5',
        )}
    >
        {children}
    </span>
);
