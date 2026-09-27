import { Pressable } from 'react-native';

import Text from '../../src/design-system/components/text';
import SymbolIcon from '../../src/design-system/components/symbol';

// Semgrep fixture (POSITIVE): kiko-design-system's `SelectableRow` component
// owns the ONE single-select list row. `kiko-no-hand-built-selectable-row`
// MUST report a finding somewhere in each block below — a bespoke
// `Pressable` reproducing SelectableRow's own selection semantics
// (`accessibilityState={{ selected: ... }}` or
// `accessibilityRole="checkbox"`) AND rendering its own leading checkmark
// (the checkmark line itself is where the rule's finding is reported — a
// `pattern-regex` line comment can't be pinned with `// EXPECT-FINDING`
// since it sits inside a JSX child position, where only a `{/* */}`
// comment parses, which the fixture-runner's own comment regex never
// matches).

export const handBuiltSelectedPressable = (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: true }}
    onPress={() => undefined}
  >
    <SymbolIcon name="checkmark" size={16} tone="onAccent" />
    <Text variant="body">Groceries</Text>
  </Pressable>
);

export const handBuiltCheckboxPressable = (
  <Pressable accessibilityRole="checkbox" onPress={() => undefined}>
    <Text variant="body">Salary</Text>
    <SymbolIcon name="checkmark" size={16} tone="onAccent" />
  </Pressable>
);
