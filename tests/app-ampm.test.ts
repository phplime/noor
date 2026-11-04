import { describe, expect, it } from 'vitest';
import { fixAmPm } from '../src/app/screens/PrayerTimeSheet';

describe('fixAmPm', () => {
  it('keeps a sensible time', () => expect(fixAmPm('13:15', '11:48')).toEqual({ time: '13:15', flipped: false, far: false }));
  it('turns 1:15 AM into PM for Dhuhr', () => expect(fixAmPm('01:15', '11:48')).toMatchObject({ time: '13:15', flipped: true }));
  it('turns 7:30 AM into PM for Isha', () => expect(fixAmPm('07:30', '18:39')).toMatchObject({ time: '19:30', flipped: true }));
  it('leaves Fajr in the morning', () => expect(fixAmPm('05:10', '04:56')).toMatchObject({ time: '05:10', flipped: false }));
  it('flags a far-off time', () => expect(fixAmPm('09:00', '15:41')).toMatchObject({ far: true, flipped: false }));
});
