import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted IBM Plex (latin subset) — Sans carries the UI, Mono carries data.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/tailwind.css';
import '@/i18n'; // install locale resolution (Paraglide) before first render
import { installDomGuard } from '@/lib/domGuard';
import { installStaleChunkGuard } from '@/lib/staleChunk';
import { clearLegacySensitiveClientStorage } from '@/lib/sensitiveClientState';
import { bootstrap } from '@/app/bootstrap';
import { Providers } from '@/app/providers';
import { App } from '@/app/App';

// Harden Node.removeChild/insertBefore against browser translation extensions
// before anything renders, so their DOM mutations can't crash React mid-commit
// with "NotFoundError: ... node to be removed is not a child of this node".
installDomGuard();

// Auto-reload once when a lazy route chunk 404s because a new build replaced
// the hashed assets (extension installs run pnpm build under live sessions).
installStaleChunkGuard();

// Purge checkout secrets and console commands left by earlier frontend builds.
clearLegacySensitiveClientStorage();

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
