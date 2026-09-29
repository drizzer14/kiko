// Semgrep fixture (NEGATIVE): kiko-no-math-min-max-spread must report
// nothing here. A fixed argument list never overflows the call stack; only a
// spread array does.
import { maxOf, minOf } from '@kiko/numbers';

type Entry = { time: number };

export const earliest = (times: number[]): number => minOf(times);

export const nextSortOrder = (entries: Entry[]): number =>
  Math.max(0, maxOf(entries.map((entry) => entry.time)));

export const clampUnit = (value: number): number => Math.min(Math.max(value, 0), 1);

export const larger = (left: number, right: number): number => Math.max(left, right);
