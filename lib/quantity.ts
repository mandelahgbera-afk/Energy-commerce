// Quantities are decimal strings with at most three places: "2.5", "0.125", "3".
// The database refuses more decimals, so a computed float must be rounded in one place
// (roundQty) and typed amounts pass through untouched (toQty).

/** A typed or stored quantity, checked and normalised: "2.50" -> "2.5". Throws bad_qty. */
export const toQty = (raw: string): string => {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) throw new Error('bad_qty');
  const value = Number(t); // safe: at most three decimals, well under 2^53
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error('bad_qty');
  return t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

/** A computed float (a sum, a share) rounded to three places as a string, honestly. */
export const roundQty = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error('bad_qty');
  return toQty(n.toFixed(3));
};
