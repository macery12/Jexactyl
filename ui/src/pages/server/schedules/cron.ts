import type { Cron } from '@/api/schedules';

// Raw 5-field cron expression (minute hour day-of-month month day-of-week),
// matching how V1 renders the schedule summary.
export function cronExpression(cron: Cron): string {
    return `${cron.minute} ${cron.hour} ${cron.dayOfMonth} ${cron.month} ${cron.dayOfWeek}`;
}
