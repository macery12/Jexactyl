import { useState } from 'react';
import AlertComponent from '@/components/AlertComponent';

interface SlideOutAlertProps {
    id: number;
    title?: string;
    content: string;
    type: 'success' | 'info' | 'warning' | 'danger';
    link?: string;
    link_text?: string;
    dismissible: boolean;
    onClose?: () => void;
    index: number;
}

export default ({ id, title, content, type, link, link_text, dismissible, onClose, index }: SlideOutAlertProps) => {
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        if (!dismissible) return;

        setIsClosing(true);
        setTimeout(() => {
            onClose?.();
        }, 300);
    };

    // Calculate position based on index - moved down to avoid header conflicts
    // Start at 5rem (80px) to clear the header, with 7rem spacing between alerts
    const topPosition = 5 + index * 7;

    // Convert 'danger' to 'error' for AlertComponent
    const alertType = type === 'danger' ? 'error' : type;

    // Build message with link if provided - don't include title in message
    const messageContent = link ? (
        <>
            {content}
            <br />
            <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-medium underline hover:no-underline"
            >
                {link_text || 'Learn more'} →
            </a>
        </>
    ) : (
        content
    );

    return (
        <div
            className={`fixed right-4 z-40 transition-all duration-300 ease-out ${
                isClosing ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
            }`}
            style={{
                top: `${topPosition}rem`,
                maxWidth: '420px',
                width: 'calc(100% - 2rem)',
            }}
        >
            <AlertComponent
                alert={{
                    id: id.toString(),
                    type: alertType as 'success' | 'error' | 'info' | 'warning',
                    message: messageContent,
                    title: title, // Only pass title once to AlertComponent
                    dismissible: dismissible,
                }}
                onDismiss={dismissible ? handleClose : undefined}
            />
        </div>
    );
};
