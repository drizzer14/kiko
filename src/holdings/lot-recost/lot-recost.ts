import { eq, inArray } from 'drizzle-orm';
import { SETTINGS_ID } from '@kiko/settings';
import { isRecord } from '@kiko/type-guards';
import { bifold, eitherSync, isLeft } from 'fnts/either';
import { logFailure, logOnFailure } from '@kiko/diagnostics';
import { write, database, holdings, settings, type HoldingRow } from '@kiko/db';

import type { HoldingType } from '../holding-type';
import { asLots, recostLots, type Lot } from '../lots';

type LotHolding = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;
type RecostedHolding = { id: string; metadata: Record<string, unknown> };

// The holding types that keep their quantity and cost in `metadata.lots`.
const LOT_HOLDING_TYPES: HoldingType[] = ['metal', 'property_item'];

const hasSameCosts = (stored: readonly Lot[], recosted: readonly Lot[]): boolean =>
  stored.every((lot, index) => lot.costMinorUnits === recosted[index]?.costMinorUnits);

// A holding's metadata with its lots costed again, or nothing when every
// cost already holds or the lots cannot be read. A sale larger than what is
// held before it (an older build let one in) keeps every stored lot: the
// user fixes it through that lot's own Edit or Delete, which re-costs all.
const recostedHolding = (holding: LotHolding): RecostedHolding[] => {
  const metadata = isRecord(holding.metadata) ? holding.metadata : {};
  const lots = asLots(metadata.lots);

  if (lots === null) {
    return [];
  }

  const recosted = eitherSync(() => recostLots(lots, holding.currency));

  if (isLeft(recosted)) {
    logFailure('[lot-recost] a holding keeps its stored lots', bifold(recosted));

    return [];
  }

  const recostedLots: Lot[] = bifold(recosted);

  return hasSameCosts(lots, recostedLots)
    ? []
    : [{ id: holding.id, metadata: { ...metadata, lots: recostedLots } }];
};

const isRecostDone = async (databaseTransaction: typeof database): Promise<boolean> => {
  const rows = await databaseTransaction
    .select({ lotsRecosted: settings.lotsRecosted })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID));

  return rows.at(0)?.lotsRecosted !== false;
};

// One transaction, re-reading the flag and the lots inside it: the lots and
// the flag commit together, so a crash or a failed write leaves the flag
// unset and the next open starts over from the stored lots. Only a changed
// list is written, and nothing is ever deleted.
const recostIn = async (databaseTransaction: typeof database): Promise<void> => {
  if (await isRecostDone(databaseTransaction)) {
    return;
  }

  const rows = await databaseTransaction
    .select({ id: holdings.id, currency: holdings.currency, metadata: holdings.metadata })
    .from(holdings)
    .where(inArray(holdings.type, LOT_HOLDING_TYPES));

  for (const holding of rows.flatMap(recostedHolding)) {
    await databaseTransaction
      .update(holdings)
      .set({ metadata: holding.metadata })
      .where(eq(holdings.id, holding.id));
  }

  await databaseTransaction
    .update(settings)
    .set({ lotsRecosted: true })
    .where(eq(settings.id, SETTINGS_ID));
};

/**
 * Works out every stored lot list's sale costs again in the one lot order,
 * once per device (`settings.lotsRecosted`), and again after a restore of a
 * backup made before it. An older build costed a sale in the order the lots
 * were recorded, so a buy added later with an earlier day left the sale's
 * cost stale. After the first run, an open reads only the flag. Never
 * rejects: a failure is logged and the next open tries again.
 */
export const recostStoredLots = async (): Promise<void> => {
  await logOnFailure('[lot-recost] recost failed', async () => {
    if (!(await isRecostDone(database))) {
      await write(recostIn);
    }
  });
};
