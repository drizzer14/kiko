import type { StyleProp, TextStyle } from 'react-native';

import type { Money } from '../../../currency/money';

export type MoneyTextContext = 'balance' | 'transaction';

// An explicit tone override, for a caller that already knows the semantic
// color a figure must render in regardless of its sign — e.g. a deposit
// ledger's tax line (always red) or interest line (always green). `neutral`
// still colors by sign (negative -> red, positive -> green, zero ->
// textPrimary/white), applied the same way no matter which `context` is
// passed — the case a ledger row with no enforced color (a contribution or
// purchase) wants. `muted` renders `textSecondary` (the same gray a caption
// uses) unconditionally — the case a normally fixed-color figure (interest,
// tax) reads as when its own amount is exactly zero, where "green" or "red"
// would misleadingly imply a nonzero accrual/withholding. Mirrors `EntryTone`
// in `src/holdings/derived-entries.ts` (so a later batch can pass a derived
// entry's tone straight through) without this module importing from the
// domain layer, keeping the design system decoupled from `holdings` — `muted`
// has no `EntryTone` counterpart on purpose, since "is this amount zero" is a
// presentation-level decision the call site makes, not a property of the
// entry's kind.
export type MoneyTextTone = 'positive' | 'negative' | 'neutral' | 'muted';

export type MoneyTextProps = {
  money: Money;
  // Selects the money color rule. `balance` (default) is a snapshot of what
  // you own, not a gain, so a positive amount stays textPrimary (white); only
  // a negative balance goes negative (red). `transaction` is a movement, so a
  // positive amount goes positive (green) — green is reserved for
  // transactions, never balances. Both contexts render zero as textPrimary
  // (white). Ignored when `tone` is supplied.
  context?: MoneyTextContext;
  // Overrides the `context`-driven color resolution above with an explicit
  // tone. Optional; when absent, behavior is unchanged (the amount is
  // colored by `context` + sign as before).
  tone?: MoneyTextTone;
  // Forwarded to the underlying Text so a caller can enlarge/align the amount
  // (e.g. the Home balance header). `color` is intentionally excluded so the
  // money tone stays authoritative.
  style?: StyleProp<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'textAlign'>>;
  // Forwarded to the underlying Text so a fixed-width column (a chart's money
  // value) can keep the amount on a single line and shrink it to fit rather
  // than wrap. Prefer shrink-to-fit over truncation for money: a truncated
  // amount misleads. All optional; when absent, wrapping is unchanged.
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
};
