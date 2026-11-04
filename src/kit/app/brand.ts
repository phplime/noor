/**
 * Branding in one place. The product name, version and bundle identifier come
 * from src-tauri/tauri.conf.json at runtime (via `app_info`); these values are
 * only fallbacks used before that call returns or in a plain browser tab.
 * To rename the app: change `productName` in tauri.conf.json, `name` in
 * package.json, and the fallback below.
 */
export const BRAND = {
  fallbackName: 'Noor',
  fallbackVersion: '0.1.0',
  tagline: 'Prayer times, reminders and photo tools',
  iconSrc: '/app-icon.png',
  privacyNote: 'All images are processed on your iPhone. Nothing is uploaded.',
} as const;
