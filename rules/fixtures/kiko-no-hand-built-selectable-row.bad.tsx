import { Pressable } from 'react-native';

import Text from '../../src/design-system/components/text';

// Semgrep fixture (POSITIVE): kiko-design-system's `SelectableRow` component
// owns the ONE single-select list row. `kiko-no-hand-built-selectable-row`
// MUST report a finding on each pinned line below — a bespoke `Pressable`
// reproducing SelectableRow's own selection semantics, either through
// `accessibilityState={{ selected: ... }}` or through
// `accessibilityRole="checkbox"`.

// EXPECT-FINDING
export const handBuiltSelectedPressable = (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: true }}
    onPress={() => undefined}
  >
    <Text variant="body">Groceries</Text>
  </Pressable>
);

// EXPECT-FINDING
export const handBuiltCheckboxPressable = (
  <Pressable accessibilityRole="checkbox" onPress={() => undefined}>
    <Text variant="body">Salary</Text>
  </Pressable>
);
