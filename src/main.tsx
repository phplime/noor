import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NoorApp } from './app/App';
// The two embedded apps' stylesheets are scoped by vite.config.ts (.kit-scope / .ni-scope).
import './kit/styles/app.css';
import './island/styles/app.css';
import './app/noor.css';

// Native feel: no long-press menu outside text fields.
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement;
  if (!(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) e.preventDefault();
});

async function boot() {
  // `npm run dev:mock` / `preview:phone`: run the UI in a normal browser with sample data.
  if (import.meta.env.VITE_MOCK) await import('./dev/mock');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <NoorApp />
    </StrictMode>,
  );
}

void boot();
