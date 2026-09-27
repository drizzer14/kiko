import TextField from '@kiko/design-system/components/text-field';

// Semgrep fixture (NEGATIVE): every placeholder below reads DIFFERENT copy
// than its own field's label, in both key/attribute orders, plus a value
// shared between both positions through a FUNCTION PARAMETER (never a
// resolvable literal, unlike a top-level `const` — Semgrep's constant
// propagation would otherwise resolve a literal-initialized `const` back to
// its own string value and flag it, which is correct: a label and
// placeholder that both resolve to the same literal through an alias ARE
// the same string value) — none of these are a real placeholder-equal-to-
// label duplication, so `kiko-no-placeholder-equal-to-label` MUST report
// nothing here.

export const categoryCopy = {
  categoryLabel: 'Category',
  categoryPlaceholder: 'Select a category',
};

export const nameCopy = {
  namePlaceholder: 'Groceries',
  nameLabel: 'Name',
};

export const buildFieldCopy = (value: string) => ({
  categoryLabel: value,
  categoryPlaceholder: value,
});

export const jsxDifferentCopy = (
  <TextField
    label="Category"
    placeholder="Select a category"
    value=""
    onChangeText={() => undefined}
  />
);

export const jsxDifferentCopySwapped = (
  <TextField placeholder="Groceries" label="Name" value="" onChangeText={() => undefined} />
);

export const jsxSharedParameter = (value: string) => (
  <TextField label={value} placeholder={value} value={value} onChangeText={() => undefined} />
);

export const kindCopy = {
  kind: 'Kind',
  kindPlaceholder: 'Select an account kind',
};

// The stem (`groceries`) and the placeholder's OWN stem (`name`) differ —
// not a field repeating its own label, even though the two values happen to
// share the same English word.
export const groceriesCopy = {
  groceries: 'Groceries',
  namePlaceholder: 'Groceries',
};
