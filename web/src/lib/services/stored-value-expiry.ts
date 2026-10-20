/**
 * Stored value credit expiry — pure FIFO calculation.
 *
 * Credits are consumed oldest-first. Given the full ledger (oldest→newest) and a
 * cutoff time, we replay debits against credit "lots" and return the total of any
 * lots that remain *and* were earned at/before the cutoff — i.e. the amount that
 * has now expired and should be debited with an `expiry_debit`.
 *
 * Existing `expiry_debit` rows are ordinary debits in the ledger, so they consume
 * the oldest lots during replay — which makes a re-run naturally compute 0 once a
 * period has already been expired.
 */

export interface LedgerEntry {
  /** Signed amount: positive = credit, negative = debit. */
  amountCents: number;
  /** Epoch milliseconds the entry was created. */
  createdAtMs: number;
}

interface Lot {
  createdAtMs: number;
  remaining: number;
}

/**
 * Returns the total cents of un-consumed credit earned at/before `cutoffMs`.
 * `entries` may be in any order; they are sorted ascending by time internally.
 */
export function computeExpirableCents(
  entries: LedgerEntry[],
  cutoffMs: number,
): number {
  const sorted = [...entries].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const lots: Lot[] = [];

  for (const entry of sorted) {
    if (entry.amountCents > 0) {
      lots.push({ createdAtMs: entry.createdAtMs, remaining: entry.amountCents });
      continue;
    }
    // Debit: consume oldest lots first.
    let need = -entry.amountCents;
    while (need > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(need, lot.remaining);
      lot.remaining -= take;
      need -= take;
      if (lot.remaining === 0) lots.shift();
    }
    // If need > 0 the ledger went negative (shouldn't happen); ignore the remainder.
  }

  return lots
    .filter((lot) => lot.createdAtMs <= cutoffMs)
    .reduce((sum, lot) => sum + lot.remaining, 0);
}
