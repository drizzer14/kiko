import type { Money } from '../../../currency/money';
import type { EntryTone } from '../../../holdings/derived-entries';

export type LedgerAmountProps = {
  money: Money;
  // The kind-derived ledger tone. `positive`/`negative` force the green/red
  // money color regardless of the amount's sign (so a tax line reads red and an
  // interest/coupon line green by KIND); `neutral` defers to the sign — a
  // money-in reads green, a money-out red, zero white — matching the
  // transaction coloring the plain ledger rows already use.
  tone: EntryTone;
};
