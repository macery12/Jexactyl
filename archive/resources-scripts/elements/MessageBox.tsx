import { useState } from 'react';

export type FlashMessageType = 'success' | 'info' | 'warning' | 'error';

interface Props {
    title?: string;
    children: string;
    type?: FlashMessageType;
}

const styling = (type?: FlashMessageType): string => {
    switch (type) {
        case 'error':
            return 'bg-red-600/25';
        case 'info':
            return 'bg-blue-600/25';
        case 'success':
            return 'bg-green-600/25';
        case 'warning':
            return 'bg-yellow-600/25';
        default:
            return '';
    }
};

const getBackground = (type?: FlashMessageType): string => {
    switch (type) {
        case 'error':
            return 'bg-red-500';
        case 'info':
            return 'bg-primary-500';
        case 'success':
            return 'bg-green-500';
        case 'warning':
            return 'bg-yellow-500';
        default:
            return '';
    }
};

const MessageBox = ({ title, children, type }: Props) => {
    const [open, setOpen] = useState(true);

    return (
        <>
            {open && (
                <div
                    className={`lg:inline-flex p-3 items-center leading-normal rounded-full flex w-full text-sm text-white mx-4 ${styling(type)}`}
                    role={'alert'}
                >
                    {title && (
                        <span
                            className={`title flex rounded-full uppercase px-2 py-1 text-xs font-bold mr-3 leading-none ${getBackground(type)}`}
                        >
                            {title}
                        </span>
                    )}
                    <span className={'mr-2 text-left flex-auto'}>{children}</span>
                    <button
                        type={'button'}
                        aria-label={'Dismiss message'}
                        className={
                            'cursor-pointer text-right font-medium text-gray-400 duration-300 hover:text-gray-300'
                        }
                        onClick={() => setOpen(false)}
                    >
                        <svg
                            xmlns={'http://www.w3.org/2000/svg'}
                            fill={'none'}
                            viewBox={'0 0 24 24'}
                            stroke={'currentColor'}
                            className={'h-5 w-5'}
                        >
                            <path
                                strokeLinecap={'round'}
                                strokeLinejoin={'round'}
                                strokeWidth={'2'}
                                d={'M6 18L18 6M6 6l12 12'}
                            />
                        </svg>
                    </button>
                </div>
            )}
        </>
    );
};
MessageBox.displayName = 'MessageBox';

export default MessageBox;
