import { invoke } from '@tauri-apps/api/core';

/** Quiet places: map pins with a radius where the phone should go quiet. */
export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  /** The user has created the iOS automation for this place. */
  automated: boolean;
  createdAt: number;
}

export type PlaceInput = Pick<Place, 'name' | 'latitude' | 'longitude' | 'radiusM'> & { id?: string };

export interface PlaceStatus {
  id: string;
  distanceM: number;
  inside: boolean;
}

export const DEFAULT_RADIUS_M = 500;

export const places = {
  list: () => invoke<Place[]>('place_list'),
  save: (place: PlaceInput) => invoke<Place>('place_save', { place }),
  setAutomated: (id: string, automated: boolean) => invoke<void>('place_set_automated', { id, automated }),
  remove: (id: string) => invoke<void>('place_delete', { id }),
  status: (latitude: number, longitude: number) => invoke<PlaceStatus[]>('place_status', { latitude, longitude }),
};

/** Great-circle distance in metres (same formula as crates/nexa-widgets/src/places.rs). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dphi = (lat2 - lat1) * rad;
  const dlam = (lon2 - lon1) * rad;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** "320 m", "1.4 km", "12 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function coordsText(p: { latitude: number; longitude: number }): string {
  return `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
}
