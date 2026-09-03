import type { FC } from 'react';
import { Text } from 'react-native';
import { match } from 'ts-pattern';
import { useUnistyles } from 'react-native-unistyles';

import { formatMoney } from '../../../currency/format';
import type { LedgerAmountProps } from './ledger-amount.props';
import type { EntryTone } from '../../../holdings/derived-entries';

type ThemeColors = ReturnType<typeof useUnistyles>['theme']['colors'];

// A `neutral` entry has no enforced color, so it reads by sign like a plain
// transaction: money-in green, money-out red, zero white.
const signColor = (colors: ThemeColors, minorUnits: number): string => {
  if (minorUnits < 0) {
    return colors.negative;
  }

  if (minorUnits > 0) {
    return colors.positive;
  }

  return colors.textPrimary;
};

const toneColor = (colors: ThemeColors, tone: EntryTone, minorUnits: number): string =>
  match(tone)
    .with('positive', () => colors.positive)
    .with('negative', () => colors.negative)
    .with('neutral', () => signColor(colors, minorUnits))
    .exhaustive();

// The amount cell of a derived ledger row (and the bond expected-profit line):
// colored by its kind-derived `tone` rather than by sign alone, so tax reads
// red and interest/coupon/expected-profit read green. The color is applied as
// an inline style (the token, read from the theme) rather than the Text
// primitive's `tone` variant, because the amount's color is a runtime, per-kind
// decision the primitive's fixed variant set does not express.
const LedgerAmount: FC<LedgerAmountProps> = ({ money, tone }) => {
  const { theme } = useUnistyles();
  const color = toneColor(theme.colors, tone, money.minorUnits);

  return <Text style={[theme.typography.body, { color }]}>{formatMoney(money)}</Text>;
};

export default LedgerAmount;
