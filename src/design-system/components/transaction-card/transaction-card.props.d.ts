import type { Money } from '@kiko/currency/money';
import type { StyleProp, ViewStyle } from 'react-native';

export type TransactionCardProps = {
  title: string;
  categoryIcon: string;
  categoryIconColor: string;
  // The icon's accessibilityLabel — the category's display title.
  categoryAccessibilityLabel: string;
  // Always rendered with `MoneyText`'s `"transaction"` context (a positive
  // amount reads green) — every consumer (Home's real row, the
  // statement-import/column-mapping preview) wants exactly that, so this is
  // not a caller-configurable prop. Optional because a transaction template's
  // amount is optional: omitted renders no amount, and the title keeps the
  // full row width.
  money?: Money;
  // The footer's left caption (Home: "account · category") and right caption
  // (Home: the transaction time). Both optional — omitted footer content
  // simply leaves that side of the row blank; the footer row itself only
  // renders when at least one is given.
  footerMeta?: string;
  footerTrailing?: string;
  // Shows a small "loan payment" marker glyph beside `footerMeta`, so a
  // linked payment reads as one at a glance regardless of how it was linked
  // (`loanLinkSource`: 'auto' or 'manual' alike — both read the same
  // marker). The caller (Home's `TransactionRow`, the holding-detail ledger
  // row) resolves whether the row is linked; omitted/false renders nothing,
  // matching every other optional footer prop's "no prop -> no output" shape.
  loanLinked?: boolean;
  // Forwarded to the underlying Card — e.g. Home's own inter-row spacing.
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
