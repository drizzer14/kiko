// Which end of a [from, to] range a freshly-picked date should move to. The
// picker no longer resets the whole range on a pick: it moves the bound nearer
// to the pick (by absolute time distance) and leaves the other bound untouched,
// so the range extends or shrinks from the side closest to the pick.
//
// Bounds are millisecond timestamps, or null for an open-ended (unset) side. A
// null bound is treated as infinitely far, so a defined bound is always the
// nearer one; when both are null (or the two distances tie exactly), the "from"
// bound moves. Because a valid range keeps from <= to, moving the nearer bound
// to the pick never inverts the range.
export type RangeBound = 'from' | 'to';

export const boundToMove = (from: number | null, to: number | null, picked: number): RangeBound => {
  if (from === null) {
    return to === null ? 'from' : 'to';
  }

  if (to === null) {
    return 'from';
  }

  return Math.abs(picked - from) <= Math.abs(picked - to) ? 'from' : 'to';
};
