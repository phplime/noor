/// <reference types="vitest/config" />
import { defineConfig, type Plugin as VitePlugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { PluginCreator, Root, Rule } from 'postcss';

// Tauri expects a fixed dev port and must not clear the terminal.
const host = process.env.TAURI_DEV_HOST;

/**
 * Noor embeds two existing apps' UIs. Their stylesheets were written for a whole
 * window (`:root`, `body`, `.card`, `.btn` …), so each one is scoped to a wrapper
 * class to keep them from clashing with each other or with Noor's own design:
 *   src/kit/**    (MacKit)       → .kit-scope
 *   src/island/** (Nexa Island)  → .ni-scope
 */
const SCOPES: [RegExp, string][] = [
  [/[\\/]src[\\/]kit[\\/]/, '.kit-scope'],
  [/[\\/]src[\\/]island[\\/]/, '.ni-scope'],
];

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim();
  if (!s) return s;
  const m = /^([^\s>+~]+)(.*)$/s.exec(s);
  if (!m) return `${scope} ${s}`;
  const [, first, restRaw] = m;
  let rest = restRaw;
  const root = /^(?:html|:root|body)((?:\[[^\]]*\])*)$/.exec(first);
  if (root) {
    const attrs = root[1];
    rest = rest.replace(/^\s+body\b/, '');
    return `${attrs ? `${attrs} ` : ''}${scope}${rest}`;
  }
  if (first === '#root') return `${scope}${rest}`;
  if (/^(?:\[[^\]]*\])+$/.test(first)) return `${first} ${scope}${rest}`;
  return `${scope} ${s}`;
}

function insideKeyframes(rule: Rule): boolean {
  type Node = { type: string; name?: string; parent?: unknown };
  let p = rule.parent as unknown as Node | undefined;
  while (p) {
    if (p.type === 'atrule' && /keyframes$/i.test(p.name ?? '')) return true;
    p = p.parent as Node | undefined;
  }
  return false;
}

const scopeCss: PluginCreator<void> = () => ({
  postcssPlugin: 'noor-scope',
  Once(root: Root, { result }) {
    const file = result.opts.from ?? '';
    const scope = SCOPES.find(([re]) => re.test(file))?.[1];
    if (!scope) return;
    root.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      const seen = new Set<string>();
      rule.selectors = rule.selectors.map((sel) => scopeSelector(sel, scope)).filter((x) => !seen.has(x) && !!seen.add(x));
    });
  },
});
scopeCss.postcss = true;

export default defineConfig({
  plugins: [react() as VitePlugin[]],
  clearScreen: false,
  css: { postcss: { plugins: [scopeCss()] } },
  server: {
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1441 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**', '**/data/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // iOS 15 WebKit is the oldest supported engine.
    target: 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
