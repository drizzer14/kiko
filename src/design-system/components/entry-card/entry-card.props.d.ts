import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type EntryCardProps = {
  // The entry's title, drawn as body text beside the amount.
  label: string;
  // The trailing amount cell. The caller renders its own `MoneyText`, because the tone and
  // context differ per kind of entry.
  amount: ReactNode;
  // An optional leading cluster (a category icon, a link marker). It shares one row with the
  // label, so only that cluster, not the label alone, is split from the amount.
  lead?: ReactNode;
  // Caption lines under the main row, right-aligned in `textSecondary`. Absent or empty draws
  // no footer.
  footerLines?: readonly string[];
  testID?: string;
  // Forwarded to the card, e.g. a projected entry's dimming.
  style?: StyleProp<ViewStyle>;
};
