import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tailwind.css';
import '@/i18n'; // install locale resolution (Paraglide) before first render
import { bootstrap } from '@/app/bootstrap';
import { Providers } from '@/app/providers';
import { App } from '@/app/App';

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
