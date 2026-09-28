import maybe, { bind, foldMap } from 'fnts/maybe';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { deviceWallClockToLocalMilliseconds, isMidnightWallClock, utcDigitsOf } from '@kiko/dates';

export type RezoneTransactionInput = Pick<
  TransactionRow,
  'id' | 'holdingId' | 'time' | 'externalId'
>;
export type RezoneHoldingInput = Pick<HoldingRow, 'id' | 'balanceSetAt'>;

type ImportTimeRezonePlan = {
  transactions: { id: string; time: number; externalId: string | null }[];
  holdings: { id: string; balanceSetAt: number }[];
};

/**
 * A legacy stored import row's `time` was written as if its bank wall clock
 * were UTC (`Date.UTC` of the raw digits). Reading those SAME digits back
 * through the device's own local zone (never Kyiv's — a stored row records
 * no format, so there is no way to tell which bank, let alone which zone, it
 * came from) reproduces exactly what a fresh re-import through column
 * mapping would write today. `utcDigitsOf` always round-trips here (it
 * reads back the exact digits `Date.UTC` was built from), so
 * `deviceWallClockToLocalMilliseconds` is never expected to reject them —
 * the `?? legacyTimeMilliseconds` fallback is a safety net, not a real path.
 */
export const rezoneImportTime = (legacyTimeMilliseconds: number): number => {
  const parts = utcDigitsOf(legacyTimeMilliseconds);
  const noonParts = isMidnightWallClock(parts) ? { ...parts, hour: 12 } : parts;

  return deviceWallClockToLocalMilliseconds(noonParts) ?? legacyTimeMilliseconds;
};

/**
 * Rewrites a dedup key's second space-separated token (`computeDedupKeyBase`:
 * `holdingId SPACE seconds SPACE amount SPACE description`) from `oldSeconds`
 * to `newSeconds`, leaving everything else — including a legacy ` n` or an
 * injective `␟n` occurrence suffix, both of which live inside the
 * description/rest portion — untouched. `null` (no rewrite) covers a `null`
 * key, a key whose shape doesn't have two space-separated tokens at all, and
 * a key whose second token isn't exactly `String(oldSeconds)` (an edited
 * description, a bank-issued id, or a key `upgradeLegacyDedupKey` hasn't
 * upgraded yet still matches here, since this only touches the time token).
 */
export const rezoneDedupKey = (
  externalId: string | null,
  oldSeconds: number,
  newSeconds: number,
): string | null => {
  if (externalId === null) {
    return null;
  }

  const firstSpace = externalId.indexOf(' ');
  const secondSpace = firstSpace === -1 ? -1 : externalId.indexOf(' ', firstSpace + 1);

  if (firstSpace === -1 || secondSpace === -1) {
    return null;
  }

  const holdingId = externalId.slice(0, firstSpace);
  const secondsToken = externalId.slice(firstSpace + 1, secondSpace);
  const rest = externalId.slice(secondSpace + 1);

  if (secondsToken !== String(oldSeconds)) {
    return null;
  }

  return `${holdingId} ${newSeconds} ${rest}`;
};

const OCCURRENCE_SUFFIX_PATTERN = /^(.*)␟(\d+)$/;

/** Splits a key into its collision-renumbering BASE and existing `␟n`
 * suffix (if any) — a legacy ` n` suffix is not stripped here (decision 6
 * only renumbers with the injective separator). */
const baseAndOccurrenceOf = (key: string): { base: string; occurrence: number | undefined } => {
  const match = OCCURRENCE_SUFFIX_PATTERN.exec(key);

  return match
    ? { base: match[1], occurrence: Number(match[2]) }
    : { base: key, occurrence: undefined };
};

type RewrittenRow = {
  id: string;
  oldTime: number;
  newTime: number;
  newExternalId: string | null;
};

/** Every occurrence number a base already carries, across ALL rows — the
 * pool a collision's later tied rows draw a fresh suffix from, so two
 * separate collisions sharing a base never hand out the same number. */
const occurrencesInUseByBase = (rows: RewrittenRow[]): Map<string, Set<number>> => {
  const inUseByBase = new Map<string, Set<number>>();

  for (const key of rows
    .map((row) => row.newExternalId)
    .filter((key): key is string => key !== null)) {
    const { base, occurrence } = baseAndOccurrenceOf(key);
    const inUse = inUseByBase.get(base) ?? new Set<number>();

    if (occurrence !== undefined) {
      inUse.add(occurrence);
    }

    inUseByBase.set(base, inUse);
  }

  return inUseByBase;
};

const countsByKey = (rows: RewrittenRow[]): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const key of rows
    .map((row) => row.newExternalId)
    .filter((key): key is string => key !== null)) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};

const nextFreeOccurrence = (inUse: Set<number>): number => {
  let candidate = 1;

  while (inUse.has(candidate)) {
    candidate += 1;
  }

  return candidate;
};

/**
 * A rezoned instant collapses two previously-distinct rows onto the SAME
 * final key (a spring-gap time, or a timed `00:00:00` row and a `12:00:00`
 * row with the same amount/description both landing on noon). Every row
 * keeps its own key unless it TIES with an earlier one (by old time, then
 * id) — a later tied row gets the next free `␟n` suffix for that key's own
 * base (`occurrencesInUseByBase`). Never throws: `nextFreeOccurrence` always
 * finds a free integer.
 */
const resolveKeyCollisions = (rows: RewrittenRow[]): Map<string, string | null> => {
  const inUseByBase = occurrencesInUseByBase(rows);
  const keyCounts = countsByKey(rows);
  const orderedRows = [...rows].sort((a, b) => a.oldTime - b.oldTime || a.id.localeCompare(b.id));
  const claimedKeys = new Set<string>();
  const finalKeyById = new Map<string, string | null>();

  for (const row of orderedRows) {
    if (row.newExternalId === null) {
      finalKeyById.set(row.id, null);
      continue;
    }

    const isColliding = (keyCounts.get(row.newExternalId) ?? 0) > 1;

    if (!isColliding || !claimedKeys.has(row.newExternalId)) {
      claimedKeys.add(row.newExternalId);
      finalKeyById.set(row.id, row.newExternalId);
      continue;
    }

    const { base } = baseAndOccurrenceOf(row.newExternalId);
    const inUse = inUseByBase.get(base) ?? new Set<number>();
    const nextOccurrence = nextFreeOccurrence(inUse);

    inUse.add(nextOccurrence);
    inUseByBase.set(base, inUse);
    finalKeyById.set(row.id, `${base}␟${nextOccurrence}`);
  }

  return finalKeyById;
};

/**
 * The pure planner both `rezoneImportTimes` (the launch-time executor) and
 * `withImportTimesRezoned` (the restore mirror) apply: rewrites every import
 * row's time and dedup key (decisions 6-7), and every affected holding's
 * `balanceSetAt` (decision 8, scoped to ITS OWN import rows only). Never
 * writes `balanceMinorUnits` — this function has no such field to write.
 */
export const planImportTimeRezone = (
  importRows: RezoneTransactionInput[],
  holdings: RezoneHoldingInput[],
): ImportTimeRezonePlan => {
  const rewrittenRows: RewrittenRow[] = importRows.map((row) => {
    const newTime = rezoneImportTime(row.time);

    return {
      id: row.id,
      oldTime: row.time,
      newTime,
      newExternalId:
        rezoneDedupKey(row.externalId, row.time / 1000, newTime / 1000) ?? row.externalId,
    };
  });
  const newTimeById = new Map(rewrittenRows.map((row) => [row.id, row.newTime]));
  const finalKeyById = resolveKeyCollisions(rewrittenRows);

  const newTimeByOldTimePerHolding = new Map<string, Map<number, number>>();

  for (const row of importRows) {
    const newTime = newTimeById.get(row.id) as number;
    const perHolding = newTimeByOldTimePerHolding.get(row.holdingId) ?? new Map<number, number>();

    perHolding.set(row.time, newTime);
    newTimeByOldTimePerHolding.set(row.holdingId, perHolding);
  }

  const rezonedHoldings = holdings.flatMap(
    (holding) =>
      foldMap(
        bind(maybe(holding.balanceSetAt), (balanceSetAt) =>
          maybe(newTimeByOldTimePerHolding.get(holding.id)?.get(balanceSetAt)),
        ),
        (newTime) => [{ id: holding.id, balanceSetAt: newTime }],
      ) ?? [],
  );

  return {
    transactions: rewrittenRows.map((row) => ({
      id: row.id,
      time: row.newTime,
      externalId: finalKeyById.get(row.id) ?? null,
    })),
    holdings: rezonedHoldings,
  };
};
