import { EyeIcon } from '@heroicons/react/outline';

/**
 * Subtle banner shown at the top of an admin page when the current user
 * has read access but no write permissions for that section.
 */
export default function AdminReadOnlyBanner() {
    return (
        <div
            className={'mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5'}
        >
            <EyeIcon className={'h-4 w-4 flex-shrink-0 text-amber-400'} />
            <p className={'text-xs text-amber-300'}>
                <span className={'font-semibold'}>Read-only access.</span> Your role can view this section but cannot
                make changes.
            </p>
        </div>
    );
}
