// A FilterMenu's stored selection can name a value that no longer exists (a
// deleted or archived account), and no checked row is left to clear it. The
// selection that filters and counts is the stored one minus those values; an
// empty result means "all". A value that only fell out of scope still exists:
// "a filter never hides an active selection" applies and it is unioned back
// instead, so do not use this for such a filter.
export const visibleSelection = (
  selected: Set<string>,
  visibleValues: readonly string[],
): Set<string> => {
  const visible = new Set(visibleValues);

  return new Set([...selected].filter((value) => visible.has(value)));
};
