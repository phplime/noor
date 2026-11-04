import { describe, expect, it } from 'vitest';
import { defaultTasbih, rollDay, suggestion, tap } from '../src/app/tasbih';

describe('tasbih', () => {
  it('counts, finishes a round and keeps daily totals', () => {
    let s = defaultTasbih();
    const now = new Date(2026, 10, 2, 9);
    let done = false;
    for (let i = 0; i < 33; i++) ({ state: s, done } = tap(s, now));
    expect(s.counts.subhanallah).toBe(33);
    expect(done).toBe(true);
    expect(s.rounds).toBe(1);
    expect(s.today).toBe(33);
    expect(s.streak).toBe(1);
  });

  it('after-salah mode moves 33 → 33 → 34 by itself', () => {
    let s = { ...defaultTasbih(), afterSalah: true };
    const now = new Date(2026, 10, 2, 13);
    let next: string | null = null;
    for (let i = 0; i < 33; i++) ({ state: s, next } = tap(s, now));
    expect(next).toBe('alhamdulillah');
    expect(s.id).toBe('alhamdulillah');
    for (let i = 0; i < 33; i++) ({ state: s } = tap(s, now));
    expect(s.id).toBe('allahuakbar');
    for (let i = 0; i < 34; i++) ({ state: s, next } = tap(s, now));
    expect(next).toBe(null);
    expect(s.rounds).toBe(3);
  });

  it('new day resets today but keeps the streak going', () => {
    let s = defaultTasbih();
    ({ state: s } = tap(s, new Date(2026, 10, 1, 22)));
    s = rollDay(s, new Date(2026, 10, 2, 6));
    expect(s.today).toBe(0);
    ({ state: s } = tap(s, new Date(2026, 10, 2, 6)));
    expect(s.streak).toBe(2);
    ({ state: s } = tap(s, new Date(2026, 10, 5, 6)));
    expect(s.streak).toBe(1);
    expect(s.total).toBe(3);
  });

  it('suggests the after-salah set soon after a prayer', () => {
    const t = new Date(2026, 10, 2, 13, 10).getTime();
    expect(suggestion([{ name: 'Dhuhr', time: t - 10 * 60_000 }], t)?.ids).toEqual(['subhanallah', 'alhamdulillah', 'allahuakbar']);
    expect(suggestion([{ name: 'Dhuhr', time: t - 90 * 60_000 }], t)).toBe(null);
  });
});
