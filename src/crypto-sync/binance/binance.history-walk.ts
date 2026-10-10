import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { logFailure } from '@kiko/diagnostics';
import type { ExchangeHolding } from '@kiko/holdings/repo';

import { BINANCE_ASSET } from './binance.client';
import { type BinanceWalletKey, binanceKeyOf, WALLET_HOLDING_NAMES } from './binance.holding-keys';

/** What one walk reports: rows imported this run, and whether it reached the end of its span. */
export type WalkResult = { imported: number; complete: boolean };

export type WalkWindow = { start: number; end: number };

/** Split [start, end] into contiguous windows of at most `windowMs`, oldest first. */
export const buildWalkWindows = (
  start: number,
  end: number,
  windowMs: number,
  maxWindows: number,
): WalkWindow[] => {
  const windows: WalkWindow[] = [];
  let cursor = start;

  for (let count = 0; count < maxWindows && cursor < end; count += 1) {
    const windowEnd = Math.min(cursor + windowMs, end);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd;
  }

  return windows;
};

/**
 * The first window start of this run. A walk with no cursor starts at its floor; a
 * re-sync always re-scans at least the last window AND everything back to the
 * cursor minus the overlap, so a record that settles late is still caught. The
 * start never predates the floor, which also bounds a cursor a disconnect reset to
 * an older floor than this walk may ask for.
 */
export const resolveWalkStart = (input: {
  cursor: number | null;
  floorMs: number;
  endTime: number;
  windowMs: number;
  overlapMs: number;
}): number => {
  const { cursor, floorMs, endTime, windowMs, overlapMs } = input;

  if (cursor === null) {
    return floorMs;
  }

  return Math.max(floorMs, Math.min(cursor - overlapMs, endTime - windowMs));
};

export type WalkPass = 'forward' | 'rescan';

/**
 * One run of a walk, as two passes. `forward` goes from the cursor minus the overlap to
 * the end and moves the walk's cursor. `rescan` goes back over the last window behind the
 * forward start, to catch a record that settles late, and never moves that cursor.
 * `rescanEnd` is where the re-scan ends, which is where the forward pass starts.
 */
export type WalkPlan = { forward: WalkWindow[]; rescan: WalkWindow[]; rescanEnd: number };

/**
 * Plan a run so that new records always come first. A walk that re-scanned its last
 * window before going forward would spend a busy account's whole call budget on ground it
 * already holds, and the newest records would never import. The re-scan resumes from the
 * walk's stored re-scan cursor, so a window too big for one run's leftover budget is
 * finished over later runs. A stored cursor outside [window start, forward start) belongs
 * to a pass that finished or a window that has moved on, and starts a new pass at the
 * window start. Neither pass starts before the floor, which also bounds a cursor a
 * disconnect reset to an older floor than this walk may ask for.
 */
export const planWalkPasses = (input: {
  cursor: number | null;
  rescanCursor: number | null;
  floorMs: number;
  endTime: number;
  windowMs: number;
  overlapMs: number;
  maxWindows: number;
}): WalkPlan => {
  const { cursor, rescanCursor, floorMs, endTime, windowMs, overlapMs, maxWindows } = input;
  const forwardStart = cursor === null ? floorMs : Math.max(floorMs, cursor - overlapMs);
  const rescanEnd = Math.min(forwardStart, endTime);
  const windowStart = Math.max(floorMs, endTime - windowMs);
  const rescanStart =
    rescanCursor !== null && rescanCursor >= windowStart && rescanCursor < rescanEnd
      ? rescanCursor
      : windowStart;

  return {
    forward: buildWalkWindows(forwardStart, endTime, windowMs, maxWindows),
    rescan: buildWalkWindows(rescanStart, rescanEnd, windowMs, maxWindows),
    rescanEnd,
  };
};

/**
 * The re-scan cursor to store once `span` of the re-scan has committed: where the span
 * ended, or `restartMs` once the re-scan has reached its end, so the next run starts a
 * new pass. `restartMs` must be the value a disconnect resets every walk cursor to, so a
 * reset and a finished pass mean the same thing.
 */
export const rescanCursorAfter = (input: {
  span: WalkWindow;
  plan: WalkPlan;
  restartMs: number;
}): number => (input.span.end >= input.plan.rescanEnd ? input.restartMs : input.span.end);

/**
 * Run a plan's windows, the forward pass first, then the re-scan on what budget is left.
 * Stops at the first window that does not complete or that the budget cannot afford, and
 * then reports the walk incomplete: a later run resumes from the stored cursors.
 */
export const runWalkPlan = async (input: {
  plan: WalkPlan;
  canAfford: () => boolean;
  runWindow: (window: WalkWindow, pass: WalkPass) => Promise<WalkResult>;
}): Promise<WalkResult> => {
  const { plan, canAfford, runWindow } = input;
  const steps = [
    ...plan.forward.map((window) => ({ window, pass: 'forward' as const })),
    ...plan.rescan.map((window) => ({ window, pass: 'rescan' as const })),
  ];
  let imported = 0;

  for (const { window, pass } of steps) {
    if (!canAfford()) {
      return { imported, complete: false };
    }

    const outcome = await runWindow(window, pass);
    imported += outcome.imported;

    if (!outcome.complete) {
      return { imported, complete: false };
    }
  }

  return { imported, complete: true };
};

const isDecimalInput = (amount: unknown): amount is string | number =>
  typeof amount === 'number' || (typeof amount === 'string' && amount.trim() !== '');

/**
 * A BTC decimal string (or number) to satoshis, or `null` when it is not a finite
 * number. A blank string is no amount: `Number('')` reads as 0 and would import a
 * zero-satoshi row.
 */
export const btcSatoshis = (amount: unknown): number | null => {
  if (!isDecimalInput(amount)) {
    return null;
  }

  const value = Number(amount);

  return Number.isFinite(value) ? Money.fromMajor(BINANCE_ASSET, value).minorUnits : null;
};

/**
 * A window the walk will not commit, because a row in it cannot be placed or
 * trusted. The code is a fixed tag; a swallowed failure logs only an error's name
 * and code, so nothing of the row (an amount, an id) can reach a log through it.
 */
export class BinanceWalkStop extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BinanceWalkStop';
    this.code = code;
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BinanceWalkStop.prototype);
  }
}

export const logWalkStop = (code: string): void => {
  logFailure('[binance sync] history window stopped', new BinanceWalkStop(code));
};

/**
 * A row the walk left out on purpose, with the window still committed. Same shape as a
 * stop, a fixed tag and a fixed code, so nothing of the row can reach a log. It carries
 * its own error name, so a log reader never mistakes a committed window for a stopped one.
 */
export const logWalkNotice = (code: string): void => {
  logFailure(
    '[binance sync] history row left out',
    Object.assign(new Error(code), { name: 'BinanceWalkNotice', code }),
  );
};

/**
 * The holding of each wanted wallet key, creating a missing one at zero balance
 * first. A missing wallet holding is a wallet that was empty at the last balance
 * sync (a never-used wallet creates none). An absent and a zero holding both add 0
 * to net worth, and the next good balance read overwrites the zero. The write is
 * insert-only, so a holding that appeared since the read is never overwritten.
 * `createKeys` (default: every key) limits which missing keys are created: a wallet
 * that receives only rows already stored elsewhere must not appear as an empty holding.
 */
export const resolveWalletHoldings = async (input: {
  accountId: string;
  keys: BinanceWalletKey[];
  createKeys?: BinanceWalletKey[];
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
}): Promise<Map<BinanceWalletKey, HoldingRow>> => {
  const { accountId, keys, createKeys = keys, listHoldings, ensureHoldings } = input;
  let current = await listHoldings(accountId);
  const missing = keys.filter(
    (key) => createKeys.includes(key) && !current.some((holding) => binanceKeyOf(holding) === key),
  );

  if (missing.length > 0) {
    await ensureHoldings(
      missing.map(
        (key): ExchangeHolding => ({
          accountId,
          name: WALLET_HOLDING_NAMES[key],
          type: 'crypto_asset',
          currency: BINANCE_ASSET,
          balanceMinorUnits: 0,
          metadataField: 'binanceAsset',
          metadataKey: key,
        }),
      ),
    );
    current = await listHoldings(accountId);
  }

  return new Map(
    keys.flatMap((key) => {
      const found = current.find((holding) => binanceKeyOf(holding) === key);

      return foldMap(maybe(found), (holding) => [[key, holding] as const]) ?? [];
    }),
  );
};
