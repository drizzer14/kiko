import type { DepthConfig } from '@kiko/crypto-sync/exchange/walk';

/**
 * How close a narrowing gets to the oldest start Binance serves: it stops once the start it knows
 * is refused and the start it knows is served are this close. Up to this much ground that Binance
 * keeps therefore lies below the start a read begins at. Measured: a start 180 days back is
 * served, 200 days back is refused. Assumed: the oldest start Binance serves moves forward, never
 * back; nothing is assumed of how fast, so it may move with the clock or in steps.
 */
export const DEPTH_RESOLUTION_MS = 1_000;

/**
 * What a read adds to the start Binance was last seen to serve, beyond the time that passed, for
 * a request that reaches Binance later than the one that found the start. Each refusal of a read
 * from such a start doubles it (see `widenDepthMargin`) up to `DEPTH_MARGIN_CAP_MS`. If the depth
 * stands still, the ground within it of the depth is the band a read begins above: it is read
 * right after the read, and owed when Binance refuses it.
 */
export const DEPTH_MARGIN_MS = 1_000;

/**
 * The most the margin grows to. A refusal of a read whose margin is at it is not answered by a
 * wider margin but by a narrowing from the refused start toward the end of the span, so the
 * margin never adds more than this to the band a read begins above.
 */
export const DEPTH_MARGIN_CAP_MS = 8_000;

/**
 * How long after it was served a start is moved forward with the clock. A read of a span that the
 * start it would be moved on to reaches into, made later than this (the app was suspended, the
 * run gate waited for hours, a run that narrows went on for minutes), finds its start by narrowing
 * (`narrowLapsedStart`), so the time that passed never decides how wide the band of a read is.
 * A run that spends the lane's call cap alone, each call paced by the gate's interval and a second
 * to answer, ends before it, so it never meets a lapse; a run that narrows lasts for minutes
 * (its calls are paced the same), so the memories of its first types lapse while it reads the
 * later ones, and a span that starts above the start a lapsed memory would be moved on to is
 * read from its own start with no narrowing (see `lapsedRangeOf`). If the depth stands still,
 * the band of a read is at most this + `DEPTH_MARGIN_CAP_MS` of the ground that Binance keeps,
 * and the `DEPTH_RESOLUTION_MS` of a narrowing is not part of it.
 */
export const DEPTH_EXTRAPOLATION_MAX_MS = 120_000;

/**
 * The refused reads one series tolerates in one span read: the sixth ends its read as a clean
 * stop, the span owed in that series. A refused read with no start known to be served, or whose
 * margin is at the cap, is answered by one narrowing; any other is answered by a wider margin and
 * the read again. A narrowing starts the margin over and it takes three refusals to reach the
 * cap, so six refusals hold the first narrowing (of the span's crossing of the depth), three
 * wider margins, and a second narrowing (of a start that lay above the first one found because
 * the depth moved meanwhile), and never a third.
 */
export const MAX_DEPTH_REFUSALS = 6;

/**
 * The lapses one series tolerates in one span read (see `DEPTH_EXTRAPOLATION_MAX_MS`): a second
 * ends its read as a clean stop, the span owed in that series. A span of 30 days therefore costs
 * a series at most `MAX_DEPTH_REFUSALS` refused reads, 23 requests of each narrowing after a
 * refusal (the end of the span and 22 halvings) and 24 of the one after a lapse (the start the
 * memory moved on to, which Binance refuses, the end of the span, and 22 halvings; when Binance
 * serves the start the memory moved on to, the halvings between it and the start the memory holds
 * are `ceil(log2(elapsed / DEPTH_RESOLUTION_MS))`, which is 22 at most for an elapsed time up to
 * 48 days): 6 + 2 * 23 + 24 = 76 requests on the depth. The 20 series of a span each have their
 * own, so a span read has no bound of its own beyond the shared lane budget: every request
 * spends it, and a series whose narrowing runs out of it is owed (see `readSeriesSpan`).
 */
const MAX_DEPTH_LAPSES = 1;

export const BINANCE_DEPTH_CONFIG: DepthConfig = {
  resolutionMs: DEPTH_RESOLUTION_MS,
  marginMs: DEPTH_MARGIN_MS,
  marginCapMs: DEPTH_MARGIN_CAP_MS,
  extrapolationMaxMs: DEPTH_EXTRAPOLATION_MAX_MS,
  maxRefusals: MAX_DEPTH_REFUSALS,
  maxLapses: MAX_DEPTH_LAPSES,
};
