import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { useFlags } from '@/state/flags';
import { firstError } from '@/lib/apiError';
import {
    getAiInference,
    getAiSettings,
    updateAiSettings,
    type AiAdminSettings,
    type AiProvider,
    type AiSettingsPayload,
} from '@/api/adminAi';
import { resolveCapabilities, type AiCapabilities } from './capabilities';

export const AI_SETTINGS_KEY = ['admin', 'ai', 'settings'] as const;
export const AI_INFERENCE_KEY = ['admin', 'ai', 'inference'] as const;

/** The settings document, shared by every page in the section. */
export function useAiSettings() {
    return useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAiSettings });
}

/**
 * What the configured provider honours.
 *
 * Takes an optional provider override so a page can reflect the value in the
 * dropdown rather than the one on file — switching provider has to redraw the
 * form immediately, not after a save.
 */
export function useAiCapabilities(provider?: AiProvider): AiCapabilities {
    const { data: settings } = useAiSettings();
    const { data: inference } = useQuery({
        queryKey: AI_INFERENCE_KEY,
        queryFn: getAiInference,
        retry: false,
        staleTime: 60_000,
    });

    return resolveCapabilities(provider ?? settings?.provider ?? 'ollama', settings, inference);
}

/**
 * One page's slice of the settings document, with dirty tracking.
 *
 * `select` narrows the document to what this page edits and `toPayload` turns
 * that back into a partial update — so a save sends only the keys the page owns
 * and cannot blank a field it never displayed. The backend is already built for
 * this: `UpdateIntelligenceSettingsRequest::normalize()` skips absent keys.
 *
 * There is deliberately no hydrate-once effect. The previous single-page form
 * latched its state on first load and never re-read the server, so a change
 * made in another tab stayed invisible until a hard reload. Here the draft is
 * null until someone types, which means an untouched page always shows what is
 * actually stored, and an edited one is never overwritten mid-edit.
 */
export function useAiSettingsForm<T extends object>(
    select: (settings: AiAdminSettings) => T,
    toPayload: (value: T) => AiSettingsPayload,
) {
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);
    const settingsQuery = useAiSettings();
    const { data: settings, isLoading, isError } = settingsQuery;
    const [draft, setDraft] = useState<T | null>(null);

    const saved = settings ? select(settings) : null;
    const value = draft ?? saved;

    // Both sides are built by the same `select`, so key order is stable and a
    // string compare is a sound (and cheap) deep compare for these flat slices.
    const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

    const save = useMutation({
        mutationFn: (next: T) => updateAiSettings(toPayload(next)),
        onSuccess: (_data, next) => {
            setDraft(null);
            push({ type: 'success', message: m['admin.ai.settings.saved']() });
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai'] });
            syncFlags(toPayload(next));
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    return {
        settings,
        isLoading,
        isError,
        retry: () => {
            void settingsQuery.refetch();
        },
        value,
        dirty,
        saving: save.isPending,
        patch: (partial: Partial<T>) =>
            setDraft(prev => {
                const base = prev ?? saved;

                return base ? { ...base, ...partial } : prev;
            }),
        discard: () => setDraft(null),
        submit: () => {
            if (value && dirty) save.mutate(value);
        },
    };
}

/**
 * Keep the live flags store in step so nav gating updates without a reload.
 *
 * Only the feature switches reach the sidebar; everything else in the document
 * is invisible to it, so a page that does not carry them writes nothing here.
 *
 * `feature_admin_agent` is the conjunction the backend composer computes
 * (`agent.enabled && agent.admin_enabled`), recomputed here for the same reason
 * — it gates the AI Assistant entry, and without this it stayed hidden until a
 * reload after the switch that should have revealed it.
 */
function syncFlags(payload: AiSettingsPayload): void {
    const { everest, site, set } = useFlags.getState();

    if (!everest) return;

    const server = payload.feature_server_assistant;
    const crash = payload.feature_crash_analysis;
    const agent = payload.agent?.enabled;
    const adminAgent = payload.agent?.admin_enabled;

    if ([server, crash, agent, adminAgent].every(flag => flag === undefined)) return;

    const nextAgent = agent ?? everest.ai.feature_agent;
    const nextAdminAgent = adminAgent ?? everest.ai.feature_admin_agent;

    set(
        {
            ...everest,
            ai: {
                ...everest.ai,
                feature_server_assistant: server ?? everest.ai.feature_server_assistant,
                feature_crash_analysis: crash ?? everest.ai.feature_crash_analysis,
                feature_agent: nextAgent,
                feature_admin_agent: nextAgent && nextAdminAgent,
            },
        },
        site,
    );
}
