// Semgrep fixture (NEGATIVE): a shared module importing only other shared
// design-system/domain modules, plus a real package whose NAME happens to
// contain "screens" (`react-native-screens`) with no `/` after it — not a
// `src/screens/**` import, so `kiko-no-import-screens-outside-ui` must stay
// clean on it.
import Box from '../../src/design-system/components/box';
import { enableScreens } from 'react-native-screens';
import type { Money } from '../../src/currency/money';

export const boxedMoney = (money: Money): [typeof Box, typeof enableScreens, Money] => [
  Box,
  enableScreens,
  money,
];
