import { format, formatDistanceToNow, differenceInHours } from 'date-fns';
import type { TicketMessage } from '@definitions/account';

interface Props {
    message: TicketMessage;
    isOwn: boolean;
}

export default ({ message, isOwn }: Props) => {
    const timestamp =
        Math.abs(differenceInHours(message.createdAt, new Date())) > 48
            ? format(message.createdAt, 'MMM do, yyyy h:mma')
            : formatDistanceToNow(message.createdAt, { addSuffix: true });

    return (
        <div className={`flex flex-col mb-4 ${isOwn ? 'items-end' : 'items-start'}`}>
            <p className={'mb-1 text-xs text-gray-400'}>
                {isOwn ? 'You' : 'Support — Administrator'} &middot; {timestamp}
            </p>
            <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isOwn
                        ? 'rounded-tr-sm bg-primary-600 text-white'
                        : 'rounded-tl-sm bg-neutral-700 text-neutral-100'
                }`}
            >
                {message.message}
            </div>
        </div>
    );
};
