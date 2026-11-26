// Pure helpers for the customer's energy record: words and chart maths only.
// Nothing here touches the database or money; the database decides every verdict.

export type Reading = {
  taken_on: string;
  backup_hours: number | string | null;
  voltage_mv: number | string | null;
  charge_pct: number | string | null;
  energy_kwh: number | string | null;
  felt: string | null;
};

/** The verdict's stage in plain words. Colour is never the only signal; the words always say it. */
export const stageWords = (stage: string): string =>
  ({
    new: 'Young battery',
    mid: 'Settled',
    ageing: 'Ageing',
    due: 'Due for a check',
    covered: 'Under warranty',
    uncovered: 'Out of warranty',
  }[stage] ?? 'Unknown');

/** One calm colour per stage, from the approved palette. */
export const stageColour = (stage: string): string =>
  ({ new: '#0F8F6B', mid: '#1B5CF0', ageing: '#D97A0B', due: '#D97A0B', covered: '#0F8F6B', uncovered: '#55606C' }[stage] ?? '#55606C');

/** Supabase may hand a number back as a string; read it without ever going through a float by accident. */
export const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** The readings one metric can draw, oldest first, only where the figure exists. */
export function chartPoints(readings: Reading[], metric: 'hours' | 'charge'): { taken_on: string; value: number }[] {
  return readings
    .map((r) => ({ taken_on: r.taken_on, value: num(metric === 'hours' ? r.backup_hours : r.charge_pct) }))
    .filter((r): r is { taken_on: string; value: number } => r.value !== null)
    .sort((a, b) => a.taken_on.localeCompare(b.taken_on));
}

/** Straight-line layout for a hand-built chart. One point sits in the middle; zero gives nothing. */
export function plot(points: { value: number }[], width: number, height: number, pad = 8) {
  if (points.length === 0) return { pts: [], min: 0, max: 0 };
  const min = Math.min(...points.map((p) => p.value), 0);
  const max = Math.max(...points.map((p) => p.value));
  const span = Math.max(max - min, 1);
  const pts = points.map((p, i) => ({
    x: points.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1),
    y: height - pad - ((p.value - min) / span) * (height - pad * 2),
  }));
  return { pts, min, max };
}

/** An SVG path string for the points. */
export const poly = (pts: { x: number; y: number }[]): string =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** "13 months" / "1 month" / "" for a null. */
export const monthCount = (n: number | string | null | undefined): string => {
  const v = num(n);
  if (v === null) return '';
  return v === 1 ? '1 month' : `${v} months`;
};

/** "12 May" for an ISO date string, so charts read calmly in any locale. With the year ("12 May 2027") where a
 *  date can be a year or more away, like a warranty's end, which without it reads as already past. */
export const dayText = (iso: string, withYear = false): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
};

/** Hours without a trailing ".00", for a reading: 6.5, 8, 0. */
export const hoursText = (v: number | string | null | undefined): string => {
  const n = num(v);
  if (n === null) return '';
  return n === Math.round(n) ? String(n) : String(n);
};
