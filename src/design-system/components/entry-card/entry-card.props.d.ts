import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type EntryCardProps = {
  // The entry's title, drawn as body text beside the amount.
  label: string;
  // The trailing amount cell. The caller renders its own `MoneyText`, because the tone and
  // context differ per kind of entry.
  amount: ReactNode;
  // An optional leading cluster (a category icon). It shares one row with the label, so only
  // that cluster, not the label alone, is split from the amount. A link marker belongs in
  // `amountCaptionIcon`.
  lead?: ReactNode;
  // A caption drawn directly under the amount in the amount column (a time), so a
  // title that wraps never separates the two.
  amountCaption?: string;
  // An SF Symbol drawn before `amountCaption` on the same line, centred on it (the loan-link
  // marker). The caption line renders even without `amountCaption`.
  amountCaptionIcon?: { name: string; testID?: string };
  // Caption lines under the WHOLE row (multi-line extras such as the upcoming split),
  // right-aligned in `textSecondary`. Absent or empty draws no footer.
  footerLines?: readonly string[];
  testID?: string;
  // Forwarded to the card, e.g. a projected entry's dimming.
  style?: StyleProp<ViewStyle>;
};
