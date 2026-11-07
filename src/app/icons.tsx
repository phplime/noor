import type { SVGProps } from 'react';

/** Noor's own stroke icon set (24×24, 1.8 stroke, round caps). */
const P = {
  today: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  routine: 'M4 6.5l1.5 1.5L8 5M4 12.5l1.5 1.5L8 11M4 18.5l1.5 1.5L8 17M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20',
  tools: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2ZM10 21h4',
  bellOff: 'M18 11a6 6 0 0 0-9.3-5M6 11v5l-2 2h14M10 21h4M3 3l18 18',
  plus: 'M12 5v14M5 12h14',
  drop: 'M12 3s6.5 6.6 6.5 11A6.5 6.5 0 0 1 5.5 14C5.5 9.6 12 3 12 3Z',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2.5 2M9 2h6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  play: 'M7 5v14l12-7L7 5Z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'm5 12 4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6 6 18',
  sound: 'M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  calendar: 'M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  sparkle: 'M12 3c.6 4.3 2.7 6.4 7 7-4.3.6-6.4 2.7-7 7-.6-4.3-2.7-6.4-7-7 4.3-.6 6.4-2.7 7-7Z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-4m0-4h.01',
  image: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 20',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  lap: 'M5 21V5m0 0h9l1 3h5v8h-6l-1-3H5',
  home: 'M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19v-7.8Z',
  mosque: 'M3 20h18M5 20v-7h14v7M7.5 13a4.5 4.5 0 0 1 9 0M12 8.5V5M10 20v-2.5a2 2 0 0 1 4 0V20',
  moonStar: 'M19 14.2A7.6 7.6 0 0 1 9.8 5a7.6 7.6 0 1 0 9.2 9.2ZM17 3.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z',
  calendarStar:
    'M8 3v3M16 3v3M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 9.5h16M12 12.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3.9-1.8Z',
  sunrise: 'M12 4v3M5.6 7.6l2.1 2.1M18.4 7.6l-2.1 2.1M3 16h18M7 16a5 5 0 0 1 10 0M5 20h14',
  sunset: 'M12 10V4M9.5 6.5 12 4l2.5 2.5M3 16h18M7 16a5 5 0 0 1 10 0M5 20h14',
  alarm: 'M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM12 10v4l2.5 1.5M4 6l3-3M20 6l-3-3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  camera: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  gift: 'M4 11h16v9H4zM3 8h18v3H3zM12 8v12M12 8C9.5 8 8 6.9 8 5.7 8 4.5 9 3.8 10 4c1.4.3 2 2 2 4Zm0 0c2.5 0 4-1.1 4-2.3 0-1.2-1-1.9-2-1.7-1.4.3-2 2-2 4Z',
  layout: 'M4 5h16v5H4zM4 14h7v6H4zM15 14h5v6h-5z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  backup: 'M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-1 7.9M12 20v-8M9 14.5l3-3 3 3',
  restore: 'M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-1 7.9M12 12v8M9 17l3 3 3-3',
  book: 'M12 6.5C10 5 7.5 4.5 4 4.5v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-14c-3.5 0-6 .5-8 2Zm0 0v14',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-1.5 2-2 3.5-2 5-1-1-1.5-2-1.5-3C8 9 6 11.5 6 15a6 6 0 0 0 6 6Z',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.8 2.8L16.5 9',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z',
  bookmark: 'M6 4h12v17l-6-4-6 4V4Z',
  skipBack: 'M19 6v12L10 12l9-6ZM6 6v12',
  skipFwd: 'M5 6v12l9-6-9-6ZM18 6v12',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10ZM7.5 11.5h2l1.5-2 2 4 1.5-2h2',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z',
} as const;

export type NoorIconName = keyof typeof P;

export function NIcon({
  name,
  size = 22,
  stroke = 1.8,
  ...rest
}: { name: NoorIconName; size?: number; stroke?: number } & Omit<SVGProps<SVGSVGElement>, 'name' | 'stroke' | 'width' | 'height' | 'ref'>) {
  const fill = name === 'play' || name === 'sparkle' ? 'currentColor' : 'none';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}

/** Noor logo mark (crescent + sparkle) for headers and the About page. */
export function NoorMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <linearGradient id="nm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141a3c" />
          <stop offset="1" stopColor="#06302e" />
        </linearGradient>
        <linearGradient id="nm-moon" x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#fff3cf" />
          <stop offset="0.45" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#e59a2f" />
        </linearGradient>
        <mask id="nm-cres">
          <rect width="1024" height="1024" fill="black" />
          <circle cx="470" cy="530" r="290" fill="white" />
          <circle cx="590" cy="440" r="250" fill="black" />
        </mask>
      </defs>
      <rect width="1024" height="1024" rx="230" fill="url(#nm-bg)" />
      <rect width="1024" height="1024" fill="url(#nm-moon)" mask="url(#nm-cres)" />
      <path
        transform="translate(668 392)"
        d="M0 -118 C 14 -30 30 -14 118 0 C 30 14 14 30 0 118 C -14 30 -30 14 -118 0 C -30 -14 -14 -30 0 -118 Z"
        fill="#fff6dc"
      />
      <path
        transform="translate(780 560) scale(0.32)"
        d="M0 -118 C 14 -30 30 -14 118 0 C 30 14 14 30 0 118 C -14 30 -30 14 -118 0 C -30 -14 -14 -30 0 -118 Z"
        fill="#ffffff"
      />
    </svg>
  );
}
