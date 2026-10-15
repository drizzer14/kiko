import type {
  BinanceSpanHints,
  BinanceWalkNumberField,
  BinanceWalkPendingField,
  BinanceWalkSpanHintField,
} from '@kiko/holdings/holding-metadata';
import { holdingsRepo } from '@kiko/holdings/repo';

import type { OwedGround } from './binance.history-walk';

/** What every Binance history walk writes to its holding's metadata, one writer for each mark. */
export type BinanceWalkWriteDeps = {
  /** Advances one walk's own watermark, or the cursor of one of its round-robins. */
  writeWalkCursor: (
    holdingId: string,
    field: BinanceWalkNumberField,
    cursorMs: number,
  ) => Promise<void>;
  /** Stores one walk's list of ground still owed, once a span has committed or the cursor moves. */
  writeWalkPending: (
    holdingId: string,
    field: BinanceWalkPendingField,
    ranges: OwedGround[],
  ) => Promise<void>;
  /** Stores one walk's span hints, the spans its split windows were left at. */
  writeWalkHints: (
    holdingId: string,
    field: BinanceWalkSpanHintField,
    hints: BinanceSpanHints,
  ) => Promise<void>;
};

export const defaultWalkWriteDeps: BinanceWalkWriteDeps = {
  writeWalkCursor: (holdingId, field, cursorMs) =>
    holdingsRepo.setBinanceWalkCursor(holdingId, field, cursorMs),
  writeWalkPending: (holdingId, field, ranges) =>
    holdingsRepo.setBinanceWalkPending(holdingId, field, ranges),
  writeWalkHints: (holdingId, field, hints) =>
    holdingsRepo.setBinanceWalkSpanHints(holdingId, field, hints),
};
