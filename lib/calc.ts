// The staff calculator's maths, exact to six decimal places with whole-number BigInt (never a
// float), so 0.1 + 0.2 is 0.3 and a naira sum never drifts. Works like a phone calculator: each
// operation is done as it is pressed, so 2 + 3 × 4 is 20.
export type Op = '+' | '−' | '×' | '÷';
export type Calc = { acc: bigint | null; op: Op | null; entry: string; err: boolean };
export const fresh: Calc = { acc: null, op: null, entry: '', err: false };

const S = 1_000_000n;
const MAX = 10n ** 15n * S;
const VAT = 75n; // 7.5% in tenths of a percent: Nigeria's standard rate

function divRound(a: bigint, b: bigint): bigint {
  const neg = a < 0n !== b < 0n;
  const A = a < 0n ? -a : a;
  const B = b < 0n ? -b : b;
  const q = (A * 2n + B) / (2n * B);
  return neg ? -q : q;
}

export function parse(t: string): bigint {
  const neg = t.startsWith('-');
  const [w, f = ''] = t.replace('-', '').split('.');
  const v = BigInt(w || '0') * S + BigInt((f + '000000').slice(0, 6));
  return neg ? -v : v;
}

const group = (w: string) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Plain digits for the entry line; commas only for show.
export function plain(v: bigint): string {
  const a = v < 0n ? -v : v;
  const frac = String(a % S).padStart(6, '0').replace(/0+$/, '');
  return `${v < 0n ? '-' : ''}${a / S}${frac ? `.${frac}` : ''}`;
}
export const show = (t: string) => {
  const [w, f] = t.split('.');
  return group(w) + (f !== undefined ? `.${f}` : '');
};

function apply(a: bigint, op: Op, b: bigint): bigint | null {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return divRound(a * b, S);
  return b === 0n ? null : divRound(a * S, b);
}

const settle = (v: bigint | null, s: Calc): Calc => (v === null || v > MAX || v < -MAX ? { ...fresh, err: true } : { ...s, acc: v });

export function display(s: Calc): string {
  if (s.err) return 'Can’t do that';
  return s.entry ? show(s.entry) : show(plain(s.acc ?? 0n));
}

export function press(s0: Calc, k: string): Calc {
  if (k === 'C') return fresh;
  const s = s0.err ? fresh : s0;
  const now = () => (s.entry && s.entry !== '-' ? parse(s.entry) : (s.acc ?? 0n));
  if (/^\d{1,2}$/.test(k)) {
    const e = (s.entry + k).replace(/^(-?)0+(?=\d)/, '$1');
    const [w, f = ''] = e.replace('-', '').split('.');
    if (w.length > 13 || f.length > 6) return s;
    // A digit after = starts a new sum.
    return s.op === null && !s.entry ? { ...s, acc: null, entry: e } : { ...s, entry: e };
  }
  if (k === '.') return s.entry.includes('.') ? s : { ...s, entry: `${s.entry || '0'}.`, ...(s.op === null && !s.entry ? { acc: null } : {}) };
  if (k === '⌫') return { ...s, entry: s.entry.slice(0, -1) };
  if (k === '+' || k === '−' || k === '×' || k === '÷') {
    if (s.op && s.entry) return { ...settle(apply(s.acc ?? 0n, s.op, now()), s), op: k, entry: '' };
    return { ...s, acc: now(), op: k, entry: '' };
  }
  if (k === '=') {
    if (s.op && s.entry) return { ...settle(apply(s.acc ?? 0n, s.op, now()), s), op: null, entry: '' };
    return { ...s, acc: now(), op: null, entry: '' };
  }
  if (k === '%') {
    const pct = divRound(now(), 100n);
    // 200 + 10% is 220, as on a phone; on its own, 10% is 0.1.
    const v = (s.op === '+' || s.op === '−') && s.acc !== null ? divRound(s.acc * pct, S) : pct;
    return s.entry || s.op ? { ...s, entry: plain(v) } : { ...s, acc: v };
  }
  if (k === 'vat+') return { ...settle(divRound(now() * (1000n + VAT), 1000n), s), op: null, entry: '' };
  if (k === 'vat-') return { ...settle(divRound(now() * 1000n, 1000n + VAT), s), op: null, entry: '' };
  return s;
}
