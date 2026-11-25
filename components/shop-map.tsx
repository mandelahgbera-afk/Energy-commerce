'use client';

// The shop's own map: MapLibre with OpenFreeMap tiles, recoloured to the shop's look. Pages load it
// with next/dynamic, so its ~470 KB (gzipped, with the worker) only arrive where a map is on screen. Nothing depends on it:
// if it fails, every screen still works in words. The style is one setting (NEXT_PUBLIC_MAP_STYLE),
// so it can move to a self-hosted copy without a code change. Why these choices:
// docs/plans/2026-11-25-orders-tracking-crm.md, decision 6.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';

export type MapPoint = { id: string; lat: number; lng: number; kind: 'drop' | 'rider'; label: string };

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';
// shortcut: the shop's own pin is not a setting yet, so an empty map opens on Lagos. Add it to Settings when a second city opens.
const START: [number, number] = [3.3792, 6.5244];

// Calm greys with the shop's blue for water, so the pins carry the colour.
function recolour(map: MlMap) {
  for (const l of (map.getStyle() as StyleSpecification).layers ?? []) {
    const id = l.id;
    try {
      if (l.type === 'background') map.setPaintProperty(id, 'background-color', '#F4F6F9');
      else if (l.type === 'fill' && /water/.test(id)) map.setPaintProperty(id, 'fill-color', '#D3DFF8');
      else if (l.type === 'fill' && /park|wood|grass/.test(id)) map.setPaintProperty(id, 'fill-color', '#E3EEE7');
      else if (l.type === 'fill' && /building/.test(id)) map.setPaintProperty(id, 'fill-color', '#E7EAEF');
      else if (l.type === 'line' && /highway|road|street|motorway|trunk|primary|secondary|tertiary|minor/.test(id) && !/casing/.test(id)) map.setPaintProperty(id, 'line-color', '#FFFFFF');
      else if (l.type === 'symbol' && l.layout?.['text-field']) {
        map.setPaintProperty(id, 'text-color', '#55606C');
        map.setPaintProperty(id, 'text-halo-color', '#F4F6F9');
      }
    } catch {}
  }
}

function pinEl(p: MapPoint) {
  const el = document.createElement('div');
  el.className = p.kind === 'rider' ? 'map-rider' : 'map-pin';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', p.label);
  el.title = p.label;
  if (p.kind === 'rider') el.textContent = p.label.trim().charAt(0).toUpperCase() || 'R';
  return el;
}

export default function ShopMap({ points, label, onPick, height = 280 }: { points: MapPoint[]; label: string; onPick?: (lat: number, lng: number) => void; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef<Marker[]>([]);
  const framed = useRef('');
  const pick = useRef(onPick);
  pick.current = onPick;
  const picking = Boolean(onPick);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (!live || !box.current) return;
        // MapLibre 6 looks for its worker beside its own script, which a bundle doesn't keep; this ships it as a file.
        ml.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
        lib.current = ml;
        const m = new ml.Map({ container: box.current, style: STYLE, center: START, zoom: 11, attributionControl: false, dragRotate: false, pitchWithRotate: false });
        m.touchZoomRotate.disableRotation();
        // OpenFreeMap's credit line comes with its style and stays visible, as its terms ask.
        m.addControl(new ml.AttributionControl({ compact: false }), 'bottom-right');
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        m.on('load', () => { recolour(m); if (live) setState('ready'); });
        m.on('error', () => { if (live && !m.isStyleLoaded()) setState('failed'); });
        m.on('click', (e) => pick.current?.(Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6))));
        map.current = m;
      } catch {
        if (live) setState('failed');
      }
    })();
    return () => { live = false; markers.current = []; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || state !== 'ready') return;
    markers.current.forEach((x) => x.remove());
    markers.current = points.map((p) => new ml.Marker({ element: pinEl(p), anchor: p.kind === 'drop' ? 'bottom' : 'center' }).setLngLat([p.lng, p.lat]).addTo(m));
    // Frame the points once per set, so a rider moving every half minute doesn't keep yanking the view.
    const ids = points.map((p) => p.id).sort().join();
    if (!points.length || ids === framed.current) return;
    framed.current = ids;
    if (points.length === 1) m.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
    else {
      const b = new ml.LngLatBounds();
      points.forEach((p) => b.extend([p.lng, p.lat]));
      m.fitBounds(b, { padding: 56, maxZoom: 15, duration: 0 });
    }
  }, [points, state]);

  return (
    <figure aria-label={label} className="shop-map" style={{ height, cursor: picking ? 'crosshair' : undefined }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {state === 'loading' ? <span role="status" className="map-note">Loading the map…</span> : null}
      {state === 'failed' ? <span role="status" className="map-note">The map could not load. Everything else on this page still works.</span> : null}
    </figure>
  );
}
