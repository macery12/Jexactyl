import { useMemo, useState } from 'react';
import { DownloadIcon, ExternalLinkIcon, RefreshIcon } from '@heroicons/react/outline';

import AdminContentBlock from '@/elements/AdminContentBlock';
import { Button } from '@/elements/button';

const docsUrl = '/api/docs';
const specUrl = '/api/openapi.json';

const ApiDocsContainer = () => {
    const [refreshing, setRefreshing] = useState(false);
    const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await fetch(`${specUrl}?refresh=1`, { credentials: 'include' });
            setRefreshedAt(new Date());
        } finally {
            setRefreshing(false);
        }
    };

    const refreshedLabel = useMemo(() => {
        if (!refreshedAt) return 'Regenerate Spec';

        return `Regenerate (last updated ${refreshedAt.toLocaleTimeString()})`;
    }, [refreshedAt]);

    return (
        <AdminContentBlock title={'API Docs'}>
            <p className={'mb-6 text-sm text-neutral-400'}>
                Swagger UI is embedded below. These docs are generated automatically from routes, validation rules, and
                resources. Use the buttons to open the UI in a new tab, download the OpenAPI JSON, or refresh the cache.
            </p>

            <div className={'flex flex-wrap gap-3'}>
                <Button onClick={() => window.open(docsUrl, '_blank')} icon={ExternalLinkIcon}>
                    Open Swagger UI
                </Button>
                <Button
                    variant={Button.Variants.Secondary}
                    onClick={() => window.open(specUrl, '_blank')}
                    icon={DownloadIcon}
                >
                    Download OpenAPI JSON
                </Button>
                <Button onClick={handleRefresh} icon={RefreshIcon} loading={refreshing}>
                    {refreshedLabel}
                </Button>
            </div>

            <div className={'mt-6 h-[70vh] overflow-hidden rounded-lg bg-neutral-900'}>
                <iframe title={'Swagger UI'} src={docsUrl} className={'h-full w-full border-0'} />
            </div>
        </AdminContentBlock>
    );
};

export default ApiDocsContainer;
