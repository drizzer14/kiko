import Text from '../../src/design-system/components/text';

// Semgrep fixture (POSITIVE): kiko-design-system's `FieldError` component
// owns the ONE inline validation-failure caption (`Text variant="caption"
// tone="negative"`). `kiko-no-raw-field-error-text` MUST report a finding
// on each pinned line below, in either attribute order.

// EXPECT-FINDING
export const variantThenTone = (
  <Text variant="caption" tone="negative">
    No file selected.
  </Text>
);

// EXPECT-FINDING
export const toneThenVariant = (
  <Text tone="negative" variant="caption">
    The key looks too short.
  </Text>
);
