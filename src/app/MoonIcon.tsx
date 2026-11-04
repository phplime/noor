import { litPath, type MoonPhase } from './moon';

/** Moon disk with its lit part, drawn inside an existing <svg> at 0,0. */
export function MoonShape({ phase, r, className = '' }: { phase: MoonPhase; r: number; className?: string }) {
  const d = litPath(phase, r);
  return (
    <g className={`n-moon ${className}`}>
      <circle r={r} className="n-moon__dark" />
      {d && <path d={d} className="n-moon__lit" />}
    </g>
  );
}

/** Stand-alone moon icon. */
export function MoonIcon({ phase, size = 12, className = '' }: { phase: MoonPhase; size?: number; className?: string }) {
  const r = size / 2 - 0.5;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className={className} aria-hidden="true">
      <MoonShape phase={phase} r={r} />
    </svg>
  );
}
