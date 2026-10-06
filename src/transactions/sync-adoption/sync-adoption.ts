/** How far apart a bank statement and the bank's own sync can date one
 * transaction: the two stamp the same purchase seconds apart. */
export const SYNC_MATCH_WINDOW_MILLISECONDS = 60_000;

type PairableRow = { holdingId: string; amountMinorUnits: number; time: number };

type SyncInput = PairableRow & { externalId?: string | null };

type ImportCandidate = PairableRow & { externalId: string | null };

type Adoption<Input, Candidate> = { candidate: Candidate; input: Input };

const groupKeyOf = ({ holdingId, amountMinorUnits }: PairableRow): string =>
  JSON.stringify([holdingId, amountMinorUnits]);

const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

const byTimeThenExternalId = (
  left: Pick<SyncInput, 'time' | 'externalId'>,
  right: Pick<SyncInput, 'time' | 'externalId'>,
): number => left.time - right.time || compareText(left.externalId ?? '', right.externalId ?? '');

/** Each (holding, signed amount)'s import rows, earliest first. */
const poolsOf = <Candidate extends ImportCandidate>(
  candidates: Candidate[],
): Map<string, Candidate[]> => {
  const pools = new Map<string, Candidate[]>();

  for (const candidate of [...candidates].sort(byTimeThenExternalId)) {
    const key = groupKeyOf(candidate);
    const pool = pools.get(key) ?? [];

    pool.push(candidate);
    pools.set(key, pool);
  }

  return pools;
};

/** The earliest unclaimed row of `pool` within the window of `time`; a claimed
 * row leaves the pool. */
const claimEarliestInReach = <Candidate extends ImportCandidate>(
  pool: Candidate[],
  time: number,
): Candidate | undefined => {
  const index = pool.findIndex(
    (candidate) => candidate.time >= time - SYNC_MATCH_WINDOW_MILLISECONDS,
  );

  if (index === -1 || pool[index].time > time + SYNC_MATCH_WINDOW_MILLISECONDS) {
    return undefined;
  }

  return pool.splice(index, 1)[0];
};

/**
 * Which new sync inputs adopt a stored statement-import row: the adoptions,
 * each an input and the import row it takes over. An input absent from them is
 * inserted as a new row.
 *
 * A disconnected bank keeps its synced rows, but a statement imported over the
 * gap writes `import` rows, and the reconnect sync fetches the same purchases
 * again under keys no import row holds. Inserting them would leave every
 * purchase in the ledger twice for good. Adopting turns the import row into the
 * sync's row in place, so the ledger keeps one row per purchase and no balance
 * moves: an adoption is a sync write, and the sync overwrites the stored
 * balance from the bank's own figure.
 *
 * An input adopts the import row of its own holding and signed amount, dated
 * within `SYNC_MATCH_WINDOW_MILLISECONDS` of the input's time on either side
 * (inclusive). Pairing is one to one: one import row stands for one bank
 * purchase. Inputs claim in (time, external id) order, never the fetch order,
 * and each takes the earliest unclaimed import row in its reach, the same
 * pairing `dropRowsHeldBySync` holds a statement row by. That claims as many
 * rows as any pairing can, where taking the nearest one could strand the only
 * row a later input reaches. Between import rows at one instant the external
 * id decides, which follows the file's own order. An input with no external id
 * has no key to be stored under, so it is inserted.
 *
 * Adoption reads the stored time only, so a stored time is the reach. RESIDUAL,
 * left unpaired and doubled: an import row from a date-only file (stored at
 * local noon of its day), a minute-clock row whose bank stamp is more than 60
 * seconds past its floored minute, and a legacy row stored at Kyiv noon for a
 * time near midnight. OPEN ITEM, not built: a clock-reach column on import
 * rows (and a migration) would let the adoption mirror `clockRangeOf`'s reach
 * for those. Until then the user deletes the import duplicate.
 */
export const pairSyncInputsWithImportRows = <
  Input extends SyncInput,
  Candidate extends ImportCandidate,
>(
  inputs: Input[],
  candidates: Candidate[],
): Adoption<Input, Candidate>[] => {
  const pools = poolsOf(candidates);
  const adopted = new Map<Input, Candidate>();

  for (const input of [...inputs].sort(byTimeThenExternalId)) {
    const candidate = input.externalId
      ? claimEarliestInReach(pools.get(groupKeyOf(input)) ?? [], input.time)
      : undefined;

    if (candidate !== undefined) {
      adopted.set(input, candidate);
    }
  }

  return Array.from(adopted, ([input, candidate]) => ({ candidate, input }));
};
