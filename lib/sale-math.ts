// The sale's numbers, worked in integer kobo with quantities as thousandth strings, mirroring
// the database's round(price * qty) and round(price * (100 - pct) / 100). No floats, ever.
// The database still decides; this only predicts what a sale will cost.

export type SaleLine = {
  productId: string;
  name: string;
  sku: string;
  unitPriceKobo: bigint;
  qty: string; // 3-decimal string, e.g. "2.5"
  needsSerials: boolean;
  serials: string[];
};

export const qtyToThousandths = (qty: string): bigint => {
  const [whole, frac = ''] = qty.split('.');
  return BigInt(whole) * 1000n + BigInt((frac + '000').slice(0, 3));
};

/** round-half-up like Postgres round() on positive amounts. */
export const roundKobo = (n: bigint): bigint => (n + 500n) / 1000n;

/** round(price * qty): the exact per-line total the database will store. */
export const lineTotalKobo = (unitPriceKobo: bigint, qty: string): bigint => roundKobo(unitPriceKobo * qtyToThousandths(qty));

/** round(price * (100 - pct) / 100): the unit price a discount asks for. */
export const discountedUnitPrice = (unitPriceKobo: bigint, discountPct: number): bigint => roundKobo(unitPriceKobo * BigInt(100 - discountPct) * 10n);

export type SaleTotals = {
  subtotalKobo: bigint;
  discountKobo: bigint;
  totalKobo: bigint;
  /** unit prices after the discount, in the same order as the lines. */
  unitPrices: bigint[];
};

export function saleTotals(lines: SaleLine[], discountPct: number): SaleTotals {
  let subtotal = 0n;
  for (const l of lines) subtotal += lineTotalKobo(l.unitPriceKobo, l.qty);
  const discount = roundKobo(subtotal * BigInt(discountPct) * 10n);
  const unitPrices = lines.map((l) => discountedUnitPrice(l.unitPriceKobo, discountPct));
  return { subtotalKobo: subtotal, discountKobo: discount, totalKobo: subtotal - discount, unitPrices };
}

export type SaleBlocker =
  | { kind: 'empty' }
  | { kind: 'serial'; line: string }
  | { kind: 'discount'; limitPct: number; askedPct: number }
  | { kind: 'method' }
  | { kind: 'till' }
  | { kind: 'tender' }
  | null;

/** What still stands between the counter and Complete, in the order the database would refuse. */
export function saleBlocker(lines: SaleLine[], method: string | null, tender: bigint | null, discountPct: number, limitPct: number, tillOpen = true): SaleBlocker {
  if (lines.length === 0) return { kind: 'empty' };
  for (const l of lines) {
    if (l.needsSerials && BigInt(l.serials.length) * 1000n < qtyToThousandths(l.qty)) return { kind: 'serial', line: l.name };
  }
  if (discountPct > limitPct) return { kind: 'discount', limitPct, askedPct: discountPct };
  if (!method) return { kind: 'method' };
  if (method === 'Cash' && !tillOpen) return { kind: 'till' };
  if (method === 'Cash' && tender === null) return { kind: 'tender' };
  return null;
}
