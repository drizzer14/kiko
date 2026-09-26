import { Pressable } from 'react-native';

import Text from '../../src/design-system/components/text';
import SelectableRow from '../../src/design-system/components/selectable-row';

// Semgrep fixture (NEGATIVE): the real `SelectableRow` component, plus an
// unrelated `Pressable` whose `accessibilityState` key is `disabled` (not
// `selected`) and whose `accessibilityRole` is `button` (not `checkbox`) —
// `kiko-no-hand-built-selectable-row` MUST report nothing here.

export const realSelectableRow = (
  <SelectableRow selected={false} onPress={() => undefined} label="Groceries" />
);

export const unrelatedDisabledPressable = (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled: true }}
    onPress={() => undefined}
  >
    <Text variant="body">Retry</Text>
  </Pressable>
);

// A segmented-control-style tab pill: it carries `accessibilityState={{
// selected: ... }}` like SelectableRow, but renders no checkmark at all — a
// genuinely different selection vocabulary (an accent-tinted pill, not a
// leading checkmark), not a hand-built copy of SelectableRow's own row
// layout.
export const tabPillNoCheckmark = (
  <Pressable
    accessibilityRole="tab"
    accessibilityState={{ selected: true }}
    onPress={() => undefined}
  >
    <Text variant="body">1W</Text>
  </Pressable>
);
