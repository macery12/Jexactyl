import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted IBM Plex (latin subset) — Sans carries the UI, Mono carries data.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@/styles/tailwind.css';
import { getCurrentLocale } from '@/i18n';
import { initializeMessages, type CatalogScope } from '@/i18n/messages';
import { installDomGuard } from '@/lib/domGuard';
import { installStaleChunkGuard } from '@/lib/staleChunk';
import { clearLegacySensitiveClientStorage } from '@/lib/sensitiveClientState';
import { bootstrap } from '@/app/bootstrap';
import { Providers } from '@/app/providers';

export async function startApplication(App: ComponentType, catalogScope: CatalogScope): Promise<void> {
    // Install runtime safety guards before React gets an opportunity to render.
    installDomGuard();
    installStaleChunkGuard();
    clearLegacySensitiveClientStorage();

    // Each server-selected entry waits only for its matching message catalog.
    await initializeMessages(getCurrentLocale(), catalogScope);

    // Read window.* globals into the stores before first render.
    bootstrap();

    const container = document.getElementById('app');
    if (!container) throw new Error('#app mount point not found');

    createRoot(container).render(
        <StrictMode>
            <Providers>
                <App />
            </Providers>
        </StrictMode>,
    );
}
