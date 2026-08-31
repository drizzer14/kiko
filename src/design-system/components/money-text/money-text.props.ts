import type { StyleProp, TextStyle } from 'react-native';
import type { Money } from '../../../currency/money';

export type MoneyTextProps = {
  money: Money;
  // Forwarded to the underlying Text so a caller can enlarge/align the amount
  // (e.g. the Home balance header). `color` is intentionally excluded so the
  // money tone (zero=white / negative=red / positive=green) stays authoritative.
  style?: StyleProp<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'textAlign'>>;
};
