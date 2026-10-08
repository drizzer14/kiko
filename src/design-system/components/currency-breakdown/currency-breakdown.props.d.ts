import type { Money } from '@kiko/currency/money';

export type CurrencyBreakdownProps = {
  // One Money total per distinct currency (see `sumByCurrency`), already
  // ordered for display.
  items: Money[];
};
