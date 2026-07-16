import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';
import Tooltip from '@/elements/tooltip/Tooltip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faPlus,
    faServer,
    faTicket,
    faUserPlus,
    faPlugCircleBolt,
    faHistory,
    IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

interface RadialAction {
    link: string;
    tooltip: string;
    icon: IconDefinition;
}

interface RadialItemProps {
    action: RadialAction;
    angle: number;
    radius: number;
    isOpen: boolean;
    index: number;
}

const BUTTON_SIZE = 48;

const RadialItem = ({ action, angle, radius, isOpen, index }: RadialItemProps) => {
    const x = Math.cos((angle * Math.PI) / 180 - Math.PI / 2) * radius;
    const y = Math.sin((angle * Math.PI) / 180 - Math.PI / 2) * radius;

    const { primary } = useStoreState(state => state.theme.data!.colors);

    return (
        <Link
            to={action.link}
            className="absolute"
            style={{
                left: BUTTON_SIZE / 2,
                top: BUTTON_SIZE / 2,
                transform: isOpen
                    ? `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1)`
                    : `translate(-50%, -50%) scale(0)`,
                opacity: isOpen ? 1 : 0,
                transition: `transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 40}ms, opacity 0.2s ease ${index * 40}ms`,
            }}
        >
            <Tooltip placement="left" content={action.tooltip} arrow>
                <div
                    className="flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110"
                    style={{ backgroundColor: primary }}
                >
                    <FontAwesomeIcon icon={action.icon} color="white" size="sm" />
                </div>
            </Tooltip>
        </Link>
    );
};

export default () => {
    const [open, setOpen] = useState<boolean>(false);
    const enabled = useStoreState(s => s.settings.data!.speed_dial);
    const extensions = useStoreState(s => s.everest.data!.extensions.enabled);
    const tickets = useStoreState(s => s.everest.data!.tickets.enabled);
    const { primary } = useStoreState(state => state.theme.data!.colors);

    if (!enabled) return <></>;

    const actions: RadialAction[] = [
        extensions ? { link: '/admin/extensions', tooltip: 'Extensions', icon: faPlugCircleBolt } : null,
        { link: '/admin/activity', tooltip: 'Activity Logs', icon: faHistory },
        { link: '/admin/servers/new', tooltip: 'Create Server', icon: faServer },
        { link: '/admin/users/new', tooltip: 'New User', icon: faUserPlus },
        tickets ? { link: '/admin/tickets', tooltip: 'View Tickets', icon: faTicket } : null,
    ].filter((item): item is RadialAction => item !== null);

    const startAngle = 270;
    const sweepAngle = 90;
    const angleStep = actions.length > 1 ? sweepAngle / (actions.length - 1) : 0;
    const radius = 110;

    return (
        <div className="fixed hidden md:block" style={{ zIndex: 9999, bottom: '45px', right: '45px' }}>
            <div className="relative" style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}>
                {actions.map((action, index) => (
                    <RadialItem
                        key={index}
                        action={action}
                        angle={startAngle + index * angleStep}
                        radius={radius}
                        isOpen={open}
                        index={index}
                    />
                ))}

                <Button
                    className="h-12 w-12"
                    onClick={() => setOpen(!open)}
                    style={{
                        backgroundColor: primary,
                        transition: 'transform 0.3s ease',
                        transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
                    }}
                >
                    <FontAwesomeIcon icon={faPlus} color="white" />
                </Button>
            </div>
        </div>
    );
};
