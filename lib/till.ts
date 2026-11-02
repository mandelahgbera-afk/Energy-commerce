// The till count: notes are counted in naira and typed per note (count by typing, not tapping),
// but the database counts in kobo. This is the one place the two meet. The first version forgot
// the ×100 and would have recorded ₦243,000 in the drawer as ₦2,430.

/** Naira notes in circulation, largest first. */
export const cashNotes = [1000, 500, 200, 100, 50, 20, 10, 5] as const;

/** How many of a note were typed: digits only, at most 5 of them. */
export const noteCount = (typed: string | undefined): bigint => BigInt((typed ?? '').replace(/\D/g, '').slice(0, 5) || '0');

/** One note's pile in kobo. */
export const noteKobo = (note: number, typed: string | undefined): bigint => BigInt(note) * 100n * noteCount(typed);

/** The whole drawer in kobo, ready for close_till. */
export const countedKobo = (counts: Record<number, string>): bigint =>
  cashNotes.reduce((sum, note) => sum + noteKobo(note, counts[note]), 0n);
