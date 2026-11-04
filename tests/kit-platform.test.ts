import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, lazy: () => (() => null) as unknown as ReturnType<typeof actual.lazy> };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('platform', () => {
  it('converts iOS picker URLs to file paths', async () => {
    const { toFsPath } = await import('../src/kit/utils/platform');
    expect(toFsPath('file:///private/var/mobile/tmp/My%20Photo.JPG')).toBe('/private/var/mobile/tmp/My Photo.JPG');
    expect(toFsPath('/Users/me/a.png')).toBe('/Users/me/a.png');
  });

  it('detects iPhone and iPad, and hides Mac-only tools there', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 });
    const { isIOS, revealLabel } = await import('../src/kit/utils/platform');
    expect(isIOS()).toBe(true);
    expect(revealLabel()).toBe('Show in Files');
    const { navigableTools } = await import('../src/kit/navigation/registry');
    const ids = navigableTools().map((t) => t.id);
    expect(ids).not.toContain('mouse-scrolling');
    expect(ids).toContain('background');
  });

  it('treats iPadOS (desktop user agent with touch) as iOS but a Mac as macOS', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 });
    expect((await import('../src/kit/utils/platform')).isIOS()).toBe(true);
    vi.resetModules();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 });
    expect((await import('../src/kit/utils/platform')).isIOS()).toBe(false);
  });
});
