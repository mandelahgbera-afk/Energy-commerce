'use client';

// The customer's energy record, shared by /my (the customer's own page) and /readings (staff).
// Hand-built SVG only, one axis per chart, plain words beside every number. Nothing here
// controls any device, and no cost or profit appears anywhere.
import { Reading, stageWords, stageColour, chartPoints, plot, poly, monthCount, dayText, hoursText, num } from '@/lib/energy';

export type Unit = {
  id: string;
  product: string;
  sku: string;
  serial: string;
  sold_on: string;
  warranty_ends_on: string | null;
  closed_on: string | null;
  verdict: {
    basis: string;
    age_months: number | string;
    life_months?: number | string | null;
    months_to_due?: number | string | null;
    warranty_left_months: number | string | null;
    stage: string;
    latest: Reading | null;
  };
  readings: Reading[];
};

const feltWords = (felt: string | null): string => ({ strong: 'feels strong', weaker: 'feels weaker', weak: 'feels weak' }[felt ?? ''] ?? '');

/** The verdict in one calm sentence, so the pill's colour is never the only signal. */
export function Verdict({ v }: { v: Unit['verdict'] }) {
  const stage = stageWords(v.stage);
  const basis =
    v.basis === 'age_vs_life'
      ? `${monthCount(v.age_months)} into the shop\u2019s usual ${monthCount(v.life_months)} battery life${v.months_to_due !== null && Number(v.months_to_due) > 0 ? ` \u00b7 ${monthCount(v.months_to_due)} to the usual due point` : ''}`
      : v.warranty_left_months !== null
        ? `sold ${monthCount(v.age_months)} ago \u00b7 ${monthCount(v.warranty_left_months)} of warranty left`
        : `sold ${monthCount(v.age_months)} ago \u00b7 out of warranty`;
  return (
    <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13.5, lineHeight: 1.45 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: `${stageColour(v.stage)}1A`, color: stageColour(v.stage), fontWeight: 600 }}>{stage}</span>
      <span style={{ color: '#434E5A' }}>{basis}</span>
    </p>
  );
}

/** The latest reading in plain words, so the table and chart are never the only places it lives. */
export function Latest({ r }: { r: Reading | null }) {
  if (!r) return <p style={{ margin: 0, fontSize: 13.5, color: '#55606C' }}>No checks recorded yet. The first check sets the baseline.</p>;
  const bits: string[] = [];
  if (num(r.backup_hours) !== null) bits.push(`${hoursText(r.backup_hours)} hours of backup`);
  if (num(r.charge_pct) !== null) bits.push(`${hoursText(r.charge_pct)}% charge`);
  if (num(r.voltage_mv) !== null) bits.push(`${(num(r.voltage_mv)! / 1000).toFixed(1)} V`);
  if (num(r.energy_kwh) !== null) bits.push(`${r.energy_kwh} kWh`);
  const felt = feltWords(r.felt);
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: '#434E5A' }}>
      Last check on {dayText(r.taken_on)}: {bits.join(', ') || 'no figures'}{felt ? `, ${felt}` : ''}.
    </p>
  );
}

/** A hand-built chart of one metric: backup hours or charge percent. One axis, quiet grid. */
export function HealthChart({ readings }: { readings: Reading[] }) {
  const hours = chartPoints(readings, 'hours');
  const charge = chartPoints(readings, 'charge');
  const series = hours.length >= charge.length ? { pts: hours, label: 'Backup hours', unit: 'h' } : { pts: charge, label: 'Charge', unit: '%' };
  if (series.pts.length === 0) return null;
  // the line keeps to a band between the top value and the dates, so a steady battery (a flat line at its best)
  // never runs through the labels
  const { pts, min, max } = plot(series.pts, 320, 84, 6);
  const rows = series.pts.map((p) => p.value);
  const longest = series.label === 'Backup hours' ? Math.max(...rows) : null;
  const latest = rows[rows.length - 1];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', margin: '0 2px 6px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#10161E' }}>{series.label} over time</p>
        <p style={{ margin: 0, fontSize: 12.5, color: '#55606C' }}>
          {longest !== null ? `Longest ${longest} ${series.unit} \u00b7 ` : ''}Latest {latest} {series.unit}
        </p>
      </div>
      <svg viewBox="0 0 320 120" role="img" aria-label={`${series.label} chart: ${rows.map((v) => `${v} ${series.unit}`).join(', ')}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 12, background: '#F7F9FB' }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="320" y1={120 * f} y2={120 * f} stroke="rgba(16,24,34,.06)" strokeWidth="1" />
        ))}
        <g transform="translate(0 18)">
          <path d={poly(pts)} fill="none" stroke="#1B5CF0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3.4" fill="#1B5CF0">
              <title>{`${dayText(series.pts[i].taken_on)}: ${series.pts[i].value} ${series.unit}`}</title>
            </circle>
          ))}
        </g>
        <text x="4" y="13" style={{ font: '500 11px var(--font-sans)', fill: '#55606C' }}>{max} {series.unit}</text>
        <text x="4" y="114" style={{ font: '500 11px var(--font-sans)', fill: '#55606C' }}>{series.pts[0].taken_on && dayText(series.pts[0].taken_on)}</text>
        <text x="316" y="114" textAnchor="end" style={{ font: '500 11px var(--font-sans)', fill: '#55606C' }}>{dayText(series.pts[series.pts.length - 1].taken_on)}</text>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {readings.slice(0, 6).map((r, i) => (
          <span key={i} style={{ padding: '4px 10px', borderRadius: 999, background: '#F1F3F5', fontSize: 12.5, color: '#434E5A' }}>
            {dayText(r.taken_on)}: {num(r.backup_hours) !== null ? `${hoursText(r.backup_hours)} h` : num(r.charge_pct) !== null ? `${hoursText(r.charge_pct)}%` : feltWords(r.felt) || 'checked'}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One unit on record: what it is, its serial, its warranty and how it is doing. */
export function UnitCard({ unit, footer }: { unit: Unit; footer?: React.ReactNode }) {
  const closed = unit.closed_on !== null;
  return (
    <article className="card rise" style={{ padding: '16px 16px 14px', opacity: closed ? 0.72 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16.5, fontWeight: 650, letterSpacing: '-.01em' }}>{unit.product}</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#55606C' }}>Serial {unit.serial} · sold {dayText(unit.sold_on, true)}{unit.warranty_ends_on ? ` · warranty to ${dayText(unit.warranty_ends_on, true)}` : ''}</p>
        </div>
        {closed ? <span style={{ padding: '3px 10px', borderRadius: 999, background: '#F1F3F5', color: '#55606C', fontSize: 12.5, fontWeight: 600 }}>Returned</span> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        <Verdict v={unit.verdict} />
      </div>
      {!closed ? (
        <div style={{ marginTop: 8 }}>
          <Latest r={unit.verdict.latest} />
        </div>
      ) : null}
      {unit.readings.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <HealthChart readings={unit.readings} />
        </div>
      ) : null}
      {footer ? <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>{footer}</div> : null}
    </article>
  );
}
