import type { TipId } from './tip-ids';

export type TipCandidate = { id: TipId; condition: boolean };

// The single place that enforces "one tip per screen": it returns at most one id.
export const pickTip = (
  candidates: readonly TipCandidate[],
  dismissed: ReadonlySet<TipId>,
): TipId | null =>
  candidates.find((candidate) => candidate.condition && !dismissed.has(candidate.id))?.id ?? null;
