import { eq, inArray } from 'drizzle-orm';
import maybe, { foldMap } from 'fnts/maybe';
import { write, holdings, bondRegister, type HoldingRow } from '@kiko/db';
import { asBondMeta, type BondPayment } from '@kiko/holdings/holding-metadata';

import { type BondTerms, cachedRegisterPayments } from '../nbu-register';

type BondRow = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;

type PaymentsBackfill = { id: string; metadata: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// A bond saved without a schedule (its key absent, never an empty one, which
// is the user's own coupon), under an ISIN the register can describe.
const pendingIsin = (row: BondRow): string[] => {
  const meta = asBondMeta(row.metadata);

  return meta?.payments === undefined && meta?.isin !== undefined ? [meta.isin] : [];
};

const backfillFor = (row: BondRow, terms: readonly BondTerms[]): PaymentsBackfill[] => {
  const meta = asBondMeta(row.metadata);

  if (meta === null || meta.payments !== undefined || !isRecord(row.metadata)) {
    return [];
  }

  const metadata = row.metadata;
  const payments = terms.reduce<BondPayment[] | null>(
    (found, candidate) => found ?? cachedRegisterPayments(meta, row.currency, candidate),
    null,
  );

  return (
    foldMap(maybe(payments), (schedule) => [
      { id: row.id, metadata: { ...metadata, payments: schedule } },
    ]) ?? []
  );
};

/**
 * The metadata to write for each bond saved without a schedule that one of
 * `terms` describes (the first that does, in order). Every other key is kept
 * as stored, so a bond saved without a price does not gain the nominal one.
 */
export const bondPaymentBackfills = (
  rows: readonly BondRow[],
  terms: readonly BondTerms[],
): PaymentsBackfill[] => rows.flatMap((row) => backfillFor(row, terms));

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
    const isins = [...new Set(bonds.flatMap(pendingIsin))];

    if (isins.length === 0) {
      return;
    }

    const cached = await databaseTransaction
      .select({ terms: bondRegister.terms })
      .from(bondRegister)
      .where(inArray(bondRegister.isin, isins));
    const backfills = bondPaymentBackfills(bonds, [
      ...freshTerms,
      ...cached.map((row) => row.terms),
    ]);

    for (const backfill of backfills) {
      await databaseTransaction
        .update(holdings)
        .set({ metadata: backfill.metadata })
        .where(eq(holdings.id, backfill.id));
    }
  });
