import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app/AppContext';
import { BRAND } from '../app/brand';
import { Icon } from '../components/Icon';
import { ConfirmDialog, Toasts } from '../components/Overlays';
import { findTool, navigableTools, toolsByCategory } from '../navigation/registry';
import { CATEGORY_LABEL, type ToolDefinition } from '../navigation/types';
import { useShortcut } from '../hooks/useShortcut';
import { isTauri } from '../services/ipc';
import { isMobile } from '../utils/platform';

const ToolbarSlot = createContext<HTMLElement | null>(null);

/** Render toolbar buttons for the active tool into the window toolbar. */
export function ToolbarActions({ active, children }: { active: boolean; children: ReactNode }) {
  const el = useContext(ToolbarSlot);
  if (!active || !el) return null;
  return createPortal(children, el);
}

const LAST_TOOL_KEY = 'mackit.lastTool';

function initialTool(): string {
  try {
    const id = localStorage.getItem(LAST_TOOL_KEY);
    if (id && navigableTools().some((t) => t.id === id)) return id;
  } catch {
    /* storage unavailable */
  }
  return 'resize-canvas';
}

function Sidebar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const mac = !isMobile();
  const { appInfo } = useApp();
  return (
    <aside className="sidebar">
      <div className="sidebar-drag" data-tauri-drag-region />
      <div className="sidebar-brand" data-tauri-drag-region>
        <img src={BRAND.iconSrc} alt="" draggable={false} />
        <div>
          <div className="name">{appInfo.name}</div>
          <div className="version">Version {appInfo.version}</div>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Tools">
        {toolsByCategory().map(({ category, tools }) => (
          <div className="nav-group" key={category}>
            <div className="nav-group-title">{CATEGORY_LABEL[category]}</div>
            {tools.map((t) => (
              <button
                key={t.id}
                className={`nav-item${t.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(t.id)}
                title={t.description}
                aria-current={t.id === activeId ? 'page' : undefined}
              >
                <Icon name={t.icon} className="nav-icon" size={16} />
                <span className="truncate">{t.name}</span>
                {mac && t.shortcut && <span className="kbd">⌘{t.shortcut}</span>}
                {mac && t.id === 'settings' && <span className="kbd">⌘,</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function AppLayout() {
  const [activeId, setActiveId] = useState(initialTool);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([activeId]));
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Phone layout: the sidebar becomes a slide-in drawer.
  const [navOpen, setNavOpen] = useState(false);
  const active = findTool(activeId) ?? navigableTools()[0];

  const select = (id: string) => {
    setNavOpen(false);
    setActiveId(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    try {
      localStorage.setItem(LAST_TOOL_KEY, id);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const t = navigableTools().find((x) => x.shortcut === e.key);
      if (t) {
        e.preventDefault();
        select(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useShortcut('mod+,', () => select('settings'));

  // Tools marked keepAlive stay mounted after their first visit so queues and settings survive switching.
  const mounted = navigableTools().filter((t) => t.id === activeId || (t.keepAlive && visited.has(t.id)));

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}${isMobile() ? ' ios' : ''}`}>
      <Sidebar activeId={active.id} onSelect={select} />
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="main">
        {!isTauri() && (
          <div className="runtime-banner" role="alert">
            <strong>You're viewing MacKit in a web browser.</strong> Opening, processing and saving files only work in the MacKit app window. Close this tab and run <code>npm run app:dev</code> — if
            the app window doesn't appear, check the Terminal for a build error.
          </div>
        )}
        <header className="toolbar" data-tauri-drag-region>
          <button className="btn ghost menu-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Show tools" aria-expanded={navOpen}>
            <Icon name="menu" size={18} />
          </button>
          <div className="toolbar-title" data-tauri-drag-region>
            <h1>{active.name}</h1>
            <span className="desc truncate" data-tauri-drag-region>
              {active.description}
            </span>
          </div>
          <div className="toolbar-actions" ref={setSlot} />
        </header>
        <ToolbarSlot.Provider value={slot}>
          <div className="content">
            {mounted.map((t) => (
              <ToolHost key={t.id} tool={t} active={t.id === active.id} />
            ))}
          </div>
        </ToolbarSlot.Provider>
      </main>
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}

function ToolHost({ tool, active }: { tool: ToolDefinition; active: boolean }) {
  const Component = tool.component;
  return (
    <div style={{ display: active ? 'block' : 'none', height: '100%' }} aria-hidden={!active}>
      <Suspense
        fallback={
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <div className="spinner" />
          </div>
        }
      >
        <Component active={active} />
      </Suspense>
    </div>
  );
}

/**
 * Noor (iPhone): one MacKit tool full-screen, with a back button instead of the
 * sidebar. Uses the same toolbar slot, so each tool's own actions still appear.
 */
export function ToolScreen({ toolId, onBack }: { toolId: string; onBack: () => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const tool = findTool(toolId) ?? navigableTools()[0];
  return (
    <div className="app-shell ios kit-embed">
      <main className="main">
        <header className="toolbar">
          <button className="btn ghost kit-back" onClick={onBack} aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <div className="toolbar-title">
            <h1>{tool.name}</h1>
            <span className="desc truncate">{tool.description}</span>
          </div>
          <div className="toolbar-actions" ref={setSlot} />
        </header>
        <ToolbarSlot.Provider value={slot}>
          <div className="content">
            <ToolHost tool={tool} active />
          </div>
        </ToolbarSlot.Provider>
      </main>
    </div>
  );
}

/** MacKit's toasts and confirm dialog, for screens rendered outside AppLayout. */
export function KitOverlays() {
  return (
    <>
      <Toasts />
      <ConfirmDialog />
    </>
  );
}
