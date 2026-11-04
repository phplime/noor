import { useEffect, useState } from 'react';

/**
 * Current weather from Open-Meteo (free, no key; data CC BY 4.0).
 * Optional: cached for offline use, refreshed every 30 minutes when online.
 */

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow';

export interface Weather {
  temp: number;
  feels: number;
  high: number;
  low: number;
  code: number;
  kind: WeatherKind;
  isDay: boolean;
  /** Chance of rain today, %. */
  rainChance: number;
  at: number;
  lat: number;
  lon: number;
}

const KEY = 'noor.weather.v1';
const FRESH = 30 * 60_000;
const STALE = 12 * 3_600_000;

export function kindOf(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'partly';
}

export const WEATHER_LABEL: Record<WeatherKind, { en: string; bn: string; icon: string }> = {
  clear: { en: 'Clear', bn: 'পরিষ্কার', icon: '☀️' },
  partly: { en: 'Partly cloudy', bn: 'আংশিক মেঘলা', icon: '⛅' },
  cloudy: { en: 'Cloudy', bn: 'মেঘলা', icon: '☁️' },
  fog: { en: 'Foggy', bn: 'কুয়াশা', icon: '🌫️' },
  drizzle: { en: 'Drizzle', bn: 'গুঁড়ি গুঁড়ি বৃষ্টি', icon: '🌦️' },
  rain: { en: 'Rain', bn: 'বৃষ্টি', icon: '🌧️' },
  storm: { en: 'Thunderstorm', bn: 'বজ্রসহ বৃষ্টি', icon: '⛈️' },
  snow: { en: 'Snow', bn: 'তুষারপাত', icon: '❄️' },
};

function cached(): Weather | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Weather | null;
    return w && typeof w.temp === 'number' ? w : null;
  } catch {
    return null;
  }
}

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const j = await r.json();
  const code = Number(j.current?.weather_code ?? 0);
  return {
    temp: Math.round(j.current.temperature_2m),
    feels: Math.round(j.current.apparent_temperature),
    high: Math.round(j.daily?.temperature_2m_max?.[0] ?? j.current.temperature_2m),
    low: Math.round(j.daily?.temperature_2m_min?.[0] ?? j.current.temperature_2m),
    code,
    kind: kindOf(code),
    isDay: j.current.is_day === 1,
    rainChance: Math.round(j.daily?.precipitation_probability_max?.[0] ?? 0),
    at: Date.now(),
    lat,
    lon,
  };
}

/** Weather for a place; returns the cached value straight away (if recent and nearby). */
export function useWeather(lat: number | undefined, lon: number | undefined): Weather | null {
  const [w, setW] = useState<Weather | null>(() => {
    const c = cached();
    return c && Date.now() - c.at < STALE ? c : null;
  });
  useEffect(() => {
    if (lat == null || lon == null) return;
    let alive = true;
    const near = (c: Weather) => Math.abs(c.lat - lat) < 0.3 && Math.abs(c.lon - lon) < 0.3;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const c = cached();
      if (c && near(c) && Date.now() - c.at < FRESH) {
        setW(c);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      fetchWeather(lat, lon)
        .then((nw) => {
          if (!alive) return;
          setW(nw);
          try {
            localStorage.setItem(KEY, JSON.stringify(nw));
          } catch {
            /* ignore */
          }
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, FRESH);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', load);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', load);
    };
  }, [lat, lon]);
  return w;
}
