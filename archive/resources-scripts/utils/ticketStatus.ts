export type TicketStatusType = 'resolved' | 'unresolved' | 'pending' | 'in-progress';
export type TicketPriorityType = 'low' | 'medium' | 'high' | 'critical';

export const statusToColor = (status: TicketStatusType): string => {
    switch (status) {
        case 'in-progress':
            return 'bg-yellow-200 text-yellow-800';
        case 'unresolved':
            return 'bg-red-200 text-red-800';
        case 'resolved':
            return 'bg-green-200 text-green-800';
        default:
            return 'bg-gray-400 text-gray-800';
    }
};

export const priorityToColor = (priority: TicketPriorityType): string => {
    switch (priority) {
        case 'critical':
            return 'bg-red-200 text-red-800';
        case 'high':
            return 'bg-orange-200 text-orange-800';
        case 'medium':
            return 'bg-yellow-200 text-yellow-800';
        default:
            return 'bg-gray-300 text-gray-700';
    }
};

export const priorityDotColor = (priority: TicketPriorityType): string => {
    switch (priority) {
        case 'critical':
            return 'bg-red-500';
        case 'high':
            return 'bg-orange-400';
        case 'medium':
            return 'bg-yellow-400';
        default:
            return 'bg-gray-400';
    }
};
