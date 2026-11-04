/**
 * Platform detection and the few things that differ between the Mac and the
 * iPhone/iPad build. Synchronous so the tool registry can use it at load time.
 */

let cached: boolean | null = null;

/** True on iPhone and iPad (including iPadOS, which reports itself as a Mac). */
export function isIOS(): boolean {
  if (cached !== null) return cached;
  if (typeof navigator === 'undefined') return (cached = false);
  const ua = navigator.userAgent;
  cached = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return cached;
}

/** True on Android phones and tablets. */
export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/** Phone or tablet (iOS or Android): mobile layout, no folders, exports in the app's own folder. */
export function isMobile(): boolean {
  return isIOS() || isAndroid();
}

/** Label for the "reveal the exported file" action. */
export const revealLabel = (): string => (isIOS() ? 'Show in Files' : 'Show in Finder');

/** Where exports appear for the user on iOS. */
export const IOS_EXPORT_LOCATION = 'Files › On My iPhone › Noor';

/**
 * Pickers on iOS return `file://` URLs; the engine needs plain paths.
 * Desktop paths pass through unchanged.
 */
export function toFsPath(p: string): string {
  if (!p.startsWith('file://')) return p;
  try {
    return decodeURIComponent(new URL(p).pathname);
  } catch {
    return decodeURIComponent(p.replace(/^file:\/\//, ''));
  }
}
