// Money is integer kobo, end to end. These two helpers are the only doors, and neither
// ever uses a float. Supabase may return bigint as a string or a number: convert here.

/** kobo (integer) -> "1500.50" decimal string. Never a float. */
export const koboToNaira = (kobo: bigint | number | string): string => {
  const s = String(kobo);
  const neg = s.startsWith('-');
  const digits = (neg ? s.slice(1) : s).replace(/\D/g, '');
  const padded = digits.padStart(3, '0');
  return `${neg ? '-' : ''}${padded.slice(0, -2)}.${padded.slice(-2)}`;
};

/** "1,500.50", "₦1500.5", "1500" -> 150050n. String maths only; throws bad_naira on nonsense. */
export const nairaToKobo = (text: string): bigint => {
  const t0 = text.trim();
  if (t0 === '') return 0n;
  if (!/^₦?-?\d+(,\d{3})*(\.\d{1,2})?$/.test(t0)) throw new Error('bad_naira');
  const t = t0.replace(/[₦,]/g, '');
  const neg = t.startsWith('-');
  const [whole, frac = ''] = (neg ? t.slice(1) : t).split('.');
  const value = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -value : value;
};

/** kobo (integer) -> "₦1,500.50", the one place naira is ever shown. */
export const formatNaira = (kobo: bigint | number | string): string => {
  const text = koboToNaira(kobo);
  const neg = text.startsWith('-');
  const [whole, frac] = (neg ? text.slice(1) : text).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₦${grouped}.${frac}`;
};
