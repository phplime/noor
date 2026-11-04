import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Place } from '../../places';

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/**
 * OpenStreetMap (Leaflet) with every quiet place drawn as a circle of its real radius.
 * Tap the map to drop a pin. Tiles need a connection; pins and circles work offline.
 */
export function PlaceMap({
  places,
  center,
  me,
  draft,
  draftRadius,
  focusKey,
  onTap,
}: {
  places: Place[];
  center: MapPoint;
  me: MapPoint | null;
  draft: MapPoint | null;
  draftRadius: number;
  /** Change this number to re-centre on `me`. */
  focusKey: number;
  onTap: (p: MapPoint) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const fitted = useRef(false);

  // create the map once
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { zoomControl: false, attributionControl: true }).setView([center.latitude, center.longitude], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => tapRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // draw pins, circles and my position
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--n-accent').trim() || '#22a67a';
    for (const p of places) {
      L.circle([p.latitude, p.longitude], { radius: p.radiusM, color: accent, weight: 2, fillColor: accent, fillOpacity: 0.16 }).addTo(g);
      L.circleMarker([p.latitude, p.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: accent, fillOpacity: 1 })
        .bindTooltip(p.name, { permanent: true, direction: 'top', offset: [0, -8], className: 'n-map-label' })
        .addTo(g);
    }
    if (draft) {
      L.circle([draft.latitude, draft.longitude], { radius: draftRadius, color: accent, weight: 2, dashArray: '6 6', fillColor: accent, fillOpacity: 0.1 }).addTo(g);
      L.circleMarker([draft.latitude, draft.longitude], { radius: 6, color: accent, weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(g);
    }
    if (me) {
      L.circleMarker([me.latitude, me.longitude], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f80ed', fillOpacity: 1 }).addTo(g);
    }
    // first time with saved places: fit them all
    if (!fitted.current && places.length > 0) {
      fitted.current = true;
      const b = L.latLngBounds(places.map((p) => [p.latitude, p.longitude] as [number, number]));
      m.fitBounds(b.pad(0.5), { maxZoom: 15 });
    }
  }, [places, me, draft, draftRadius]);

  // re-centre on me
  useEffect(() => {
    if (focusKey > 0 && me && map.current) map.current.setView([me.latitude, me.longitude], 15, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return <div ref={host} className="n-map" role="application" aria-label="Map of your quiet places" />;
}
