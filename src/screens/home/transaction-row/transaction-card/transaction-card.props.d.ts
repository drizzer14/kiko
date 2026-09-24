import type { StyleProp, ViewStyle } from 'react-native';

import type { Money } from '../../../../currency/money';
import type { MoneyTextContext } from '../../../../design-system/components/money-text/money-text.props';

export type TransactionCardProps = {
  title: string;
  categoryIcon: string;
  categoryIconColor: string;
  // The icon's accessibilityLabel — the category's display title.
  categoryAccessibilityLabel: string;
  money: Money;
  moneyContext?: MoneyTextContext;
  // The footer's left caption (Home: "account · category") and right caption
  // (Home: the transaction time). Both optional — omitted footer content
  // simply leaves that side of the row blank; the footer row itself only
  // renders when at least one is given.
  footerMeta?: string;
  footerTrailing?: string;
  // Forwarded to the underlying Card — e.g. Home's own inter-row spacing.
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
