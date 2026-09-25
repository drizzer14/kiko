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
