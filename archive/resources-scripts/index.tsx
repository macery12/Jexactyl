import { render } from 'preact';
import { App } from '@/components/App';
import '@/i18n';

window.addEventListener('vite:preloadError', event => {
    console.warn('Stale chunk detected, reloading...', event);
    window.location.reload();
});

render(<App />, document.getElementById('app')!);
