import type { PrayerTimeEntry } from '../lib/types';

/** Marks manual times, minute adjustments and high-latitude estimates. */
export function SourceBadge({ entry }: { entry: PrayerTimeEntry }) {
  if (entry.source === 'manual') {
    return (
      <span className="badge badge--manual" title="Entered manually">
        Manual
      </span>
    );
  }
  return (
    <>
      {entry.offsetMinutes !== 0 && (
        <span className="badge" title="Adjusted from the calculated time">
          {entry.offsetMinutes > 0 ? '+' : '−'}
          {Math.abs(entry.offsetMinutes)}m
        </span>
      )}
      {entry.highLatitudeAdjusted && (
        <span className="badge badge--warn" title="Estimated with the high-latitude rule">
          Est.
        </span>
      )}
    </>
  );
}
