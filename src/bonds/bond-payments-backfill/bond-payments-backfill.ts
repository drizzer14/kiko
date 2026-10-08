import { eq, inArray } from 'drizzle-orm';
import maybe, { foldMap } from 'fnts/maybe';
import { write, holdings, bondRegister, type HoldingRow } from '@kiko/db';
import { asBondMeta, type BondMeta, type BondPayment } from '@kiko/holdings/holding-metadata';

import { type BondTerms, cachedRegisterPayments } from '../nbu-register';

type BondRow = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;

type PendingBond = { row: BondRow; meta: BondMeta; isin: string };

type PaymentsBackfill = { id: string; metadata: Record<string, unknown> };

// A bond saved without a schedule (its key absent, never an empty one, which
// is the user's own coupon), under an ISIN the register can describe.
const pendingBond = (row: BondRow): PendingBond[] => {
  const meta = asBondMeta(row.metadata);

  return meta?.payments === undefined && meta?.isin !== undefined
    ? [{ row, meta, isin: meta.isin }]
    : [];
};

const backfillFor = (
  { row, meta }: PendingBond,
  terms: readonly BondTerms[],
): PaymentsBackfill[] => {
  const payments = terms.reduce<BondPayment[] | null>(
    (found, candidate) => found ?? cachedRegisterPayments(meta, row.currency, candidate),
    null,
  );
  // `asBondMeta` parsed it, so the stored metadata is a record.
  const metadata = row.metadata as Record<string, unknown>;

  return (
    foldMap(maybe(payments), (schedule) => [
      { id: row.id, metadata: { ...metadata, payments: schedule } },
    ]) ?? []
  );
};

const backfillsFor = (pending: readonly PendingBond[], terms: readonly BondTerms[]) =>
  pending.flatMap((bond) => backfillFor(bond, terms));

/**
 * The metadata to write for each bond saved without a schedule that one of
 * `terms` describes (the first that does, in order). Every other key is kept
 * as stored, so a bond saved without a price does not gain the nominal one.
 */
export const bondPaymentBackfills = (
  rows: readonly BondRow[],
  terms: readonly BondTerms[],
): PaymentsBackfill[] => backfillsFor(rows.flatMap(pendingBond), terms);

/**
 * Keeps the register schedule in every bond saved before bonds kept their
 * own, so its coupons survive the ISIN later leaving the cache. Runs in the
 * daily register refresh, before the cache is replaced: `freshTerms` first,
 * then the rows still cached, so an ISIN the fresh fetch dropped (matured or
 * delisted) is still kept. One write that re-reads every bond inside it and
 * writes only one still missing a schedule and still matching, so a stale
 * row can never overwrite a newer edit.
 */
export const backfillBondPayments = (freshTerms: readonly BondTerms[]): Promise<void> =>
  write(async (databaseTransaction) => {
    const bonds = await databaseTransaction
      .select({ id: holdings.id, currency: holdings.currency, metadata: holdings.metadata })
      .from(holdings)
      .where(eq(holdings.type, 'bond'));
    const pending = bonds.flatMap(pendingBond);
    const isins = [...new Set(pending.map((bond) => bond.isin))];

    if (isins.length === 0) {
      return;
    }

    const cached = await databaseTransaction
      .select({ terms: bondRegister.terms })
      .from(bondRegister)
      .where(inArray(bondRegister.isin, isins));
    const backfills = backfillsFor(pending, [...freshTerms, ...cached.map((row) => row.terms)]);

    for (const backfill of backfills) {
      await databaseTransaction
        .update(holdings)
        .set({ metadata: backfill.metadata })
        .where(eq(holdings.id, backfill.id));
    }
  });
