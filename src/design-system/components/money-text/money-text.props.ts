import type { StyleProp, TextStyle } from 'react-native';
import type { Money } from '../../../currency/money';

export type MoneyTextContext = 'balance' | 'transaction';

export type MoneyTextProps = {
  money: Money;
  // Selects the money color rule. `balance` (default) is a snapshot of what
  // you own, not a gain, so a positive amount stays textPrimary (white); only
  // a negative balance goes negative (red). `transaction` is a movement, so a
  // positive amount goes positive (green) — green is reserved for
  // transactions, never balances. Both contexts render zero as textPrimary
  // (white).
  context?: MoneyTextContext;
  // Forwarded to the underlying Text so a caller can enlarge/align the amount
  // (e.g. the Home balance header). `color` is intentionally excluded so the
  // money tone stays authoritative.
  style?: StyleProp<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'textAlign'>>;
};
