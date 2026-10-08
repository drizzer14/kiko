import TextField from '../../src/design-system/components/text-field';

// Semgrep fixture (POSITIVE): kiko-design-system's "Field placeholder and
// error copy" — a placeholder never repeats its own field's label.
// `kiko-no-placeholder-equal-to-label` MUST report a finding on each pinned
// line below: an object literal holding a `*Placeholder` key and a sibling
// key with the SAME string value, in both key orders, and a JSX element
// whose `placeholder`/`label` string attributes are equal, in both
// attribute orders.

export const labelBeforePlaceholder = {
  // EXPECT-FINDING
  categoryLabel: 'Groceries',
  categoryPlaceholder: 'Groceries',
};

export const placeholderBeforeLabel = {
  // EXPECT-FINDING
  categoryPlaceholder: 'Groceries',
  categoryLabel: 'Groceries',
};

// EXPECT-FINDING
export const jsxPlaceholderThenLabel = (
  <TextField placeholder="Groceries" label="Groceries" value="" onChangeText={() => undefined} />
);

// EXPECT-FINDING
export const jsxLabelThenPlaceholder = (
  <TextField label="Groceries" placeholder="Groceries" value="" onChangeText={() => undefined} />
);

// A BARE stem key (no `Label` suffix) paired with its own `*Placeholder`
// key, same value — most of the catalogue's real keys are named this way
// (`kind`/`kindPlaceholder`), not `kindLabel`/`kindPlaceholder`.
export const kindCopy = {
  // EXPECT-FINDING
  kind: 'Kind',
  kindPlaceholder: 'Kind',
};
