import React from 'react';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

interface AlertProps {
    type: 'success' | 'info' | 'warning' | 'danger';
    className?: string;
    children: React.ReactNode;
    small?: boolean;
    onClose?: () => void;
}

export default ({ type, className, children, small, onClose }: AlertProps) => {
    return (
        <div
            className={classNames(
                'flex items-start rounded-md border-l-8 shadow',
                small ? 'px-2 py-2 text-xs' : 'px-4 py-3',
                {
                    ['border-green-500 bg-green-500/30 text-green-50']: type === 'success',
                    ['border-blue-500 bg-blue-500/30 text-blue-50']: type === 'info',
                    ['border-yellow-500 bg-yellow-500/30 text-yellow-50']: type === 'warning',
                    ['border-red-500 bg-red-500/30 text-red-50']: type === 'danger',
                },
                className,
            )}
        >
            <div className="flex-1">{children}</div>
            {onClose && (
                <button
                    onClick={onClose}
                    className={'ml-3 flex-shrink-0 text-gray-400 transition-colors hover:text-gray-200'}
                    aria-label="Close alert"
                >
                    <FontAwesomeIcon icon={faTimes} className={'h-4 w-4'} />
                </button>
            )}
        </div>
    );
};
