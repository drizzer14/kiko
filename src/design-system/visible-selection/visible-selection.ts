// A FilterMenu's stored selection can name a value that has since left its
// options (an account archived or deleted while the filter was set), and no
// checked row is left to clear it. The selection that filters and counts is the
// stored one minus those values; an empty result means "all".
export const visibleSelection = (
  selected: Set<string>,
  visibleValues: readonly string[],
): Set<string> => {
  const visible = new Set(visibleValues);

  return new Set([...selected].filter((value) => visible.has(value)));
};
