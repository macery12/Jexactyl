import http from '@/lib/http';

// Client schedule + task endpoints (/api/client/servers/{uuid}/schedules[/tasks]),
// ported from V1's routes/server/{schedules,tasks}.ts. A schedule is a cron
// expression owning an ordered list of tasks (power / command / backup actions)
// that run in sequence with per-task time offsets.

export interface Cron {
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
}

export interface Task {
    id: number;
    sequenceId: number;
    action: string;
    payload: string;
    timeOffset: number;
    isQueued: boolean;
    continueOnFailure: boolean;
}

export interface Schedule {
    id: number;
    name: string;
    cron: Cron;
    isActive: boolean;
    isProcessing: boolean;
    onlyWhenOnline: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    tasks: Task[];
}

interface FractalTask {
    attributes: {
        id: number;
        sequence_id: number;
        action: string;
        payload: string;
        time_offset: number;
        is_queued: boolean;
        continue_on_failure: boolean;
    };
}

interface FractalSchedule {
    attributes: {
        id: number;
        name: string;
        cron: { minute: string; hour: string; day_of_month: string; month: string; day_of_week: string };
        is_active: boolean;
        is_processing: boolean;
        only_when_online: boolean;
        last_run_at: string | null;
        next_run_at: string | null;
        relationships?: { tasks?: { data: FractalTask[] } };
    };
}

function toTask({ attributes: a }: FractalTask): Task {
    return {
        id: a.id,
        sequenceId: a.sequence_id,
        action: a.action,
        payload: a.payload,
        timeOffset: a.time_offset,
        isQueued: a.is_queued,
        continueOnFailure: a.continue_on_failure,
    };
}

function toSchedule({ attributes: a }: FractalSchedule): Schedule {
    return {
        id: a.id,
        name: a.name,
        cron: {
            minute: a.cron.minute,
            hour: a.cron.hour,
            dayOfMonth: a.cron.day_of_month,
            month: a.cron.month,
            dayOfWeek: a.cron.day_of_week,
        },
        isActive: a.is_active,
        isProcessing: a.is_processing,
        onlyWhenOnline: a.only_when_online,
        lastRunAt: a.last_run_at,
        nextRunAt: a.next_run_at,
        tasks: (a.relationships?.tasks?.data ?? []).map(toTask).sort((x, y) => x.sequenceId - y.sequenceId),
    };
}

export async function getSchedules(uuid: string): Promise<Schedule[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/schedules`, {
        params: { include: ['tasks'] },
    });
    return (data.data ?? []).map(toSchedule);
}

export async function getSchedule(uuid: string, id: number): Promise<Schedule> {
    const { data } = await http.get(`/api/client/servers/${uuid}/schedules/${id}`, {
        params: { include: ['tasks'] },
    });
    return toSchedule(data);
}

export interface ScheduleInput {
    id?: number;
    name: string;
    cron: Cron;
    isActive: boolean;
    onlyWhenOnline: boolean;
}

export async function saveSchedule(uuid: string, schedule: ScheduleInput): Promise<Schedule> {
    const { data } = await http.post(
        `/api/client/servers/${uuid}/schedules${schedule.id ? `/${schedule.id}` : ''}`,
        {
            name: schedule.name,
            is_active: schedule.isActive,
            only_when_online: schedule.onlyWhenOnline,
            minute: schedule.cron.minute,
            hour: schedule.cron.hour,
            day_of_month: schedule.cron.dayOfMonth,
            month: schedule.cron.month,
            day_of_week: schedule.cron.dayOfWeek,
        },
    );
    return toSchedule(data);
}

export async function triggerSchedule(uuid: string, id: number): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/schedules/${id}/execute`);
}

export async function deleteSchedule(uuid: string, id: number): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/schedules/${id}`);
}

export interface TaskInput {
    id?: number;
    action: string;
    payload: string;
    timeOffset: number;
    continueOnFailure: boolean;
}

export async function saveTask(uuid: string, scheduleId: number, task: TaskInput): Promise<Task> {
    const { data } = await http.post(
        `/api/client/servers/${uuid}/schedules/${scheduleId}/tasks${task.id ? `/${task.id}` : ''}`,
        {
            action: task.action,
            payload: task.payload,
            time_offset: task.timeOffset,
            continue_on_failure: task.continueOnFailure,
        },
    );
    return toTask(data);
}

export async function deleteTask(uuid: string, scheduleId: number, taskId: number): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/schedules/${scheduleId}/tasks/${taskId}`);
}
