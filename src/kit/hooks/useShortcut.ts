import { useEffect, useRef } from 'react';

/**
 * Register a keyboard shortcut such as "mod+o", "mod+shift+o", "mod+enter",
 * "mod+z", "escape". `mod` is ⌘ on macOS (Ctrl elsewhere).
 */
export function useShortcut(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const wantMod = parts.includes('mod');
    const wantShift = parts.includes('shift');
    const wantAlt = parts.includes('alt');
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod !== wantMod || e.shiftKey !== wantShift || e.altKey !== wantAlt) return;
      const k = e.key.toLowerCase();
      const matches = k === key || (key === 'enter' && k === 'enter') || (key === '=' && (k === '=' || k === '+')) || (key === 'escape' && k === 'escape');
      if (!matches) return;
      // Plain keys must not fire while typing in a field.
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing && !wantMod && key !== 'escape') return;
      if (typing && wantMod && key === 'z') return; // keep native text undo
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, enabled]);
}
