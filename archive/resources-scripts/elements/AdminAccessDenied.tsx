import { LockClosedIcon } from '@heroicons/react/outline';
import { Link } from 'react-router-dom';
import { useStoreState } from '@/state/hooks';

interface Props {
    permission?: string;
}

/**
 * Full-page access denied block displayed inside the admin panel layout
 * when the current user lacks the required role permission.
 */
export default function AdminAccessDenied({ permission }: Props) {
    const { secondary } = useStoreState(state => state.theme.data!.colors);

    return (
        <div
            className={'flex min-h-[60vh] flex-col items-center justify-center rounded-xl p-12 text-center'}
            style={{ backgroundColor: secondary }}
        >
            <div className={'mb-6 rounded-full bg-red-500/10 p-4 ring-1 ring-red-500/30'}>
                <LockClosedIcon className={'h-10 w-10 text-red-400'} />
            </div>

            <h1 className={'mb-2 text-2xl font-bold text-neutral-100'}>Access Denied</h1>
            <p className={'mb-4 max-w-md text-sm text-neutral-400'}>
                You don&apos;t have permission to view this page. Contact a root administrator if you need access.
            </p>

            {permission && (
                <p className={'mb-6 rounded-md bg-neutral-800 px-3 py-1.5 font-mono text-xs text-neutral-400'}>
                    Required permission: <span className={'text-neutral-200'}>{permission}</span>
                </p>
            )}

            <Link
                to={'/admin'}
                className={
                    'rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100'
                }
            >
                ← Return to Overview
            </Link>
        </div>
    );
}
