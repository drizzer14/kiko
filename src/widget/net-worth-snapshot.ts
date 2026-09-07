import type { Currency } from '../currency/currency';
import { formatMoney } from '../currency/format';
import type { AccountRow, HoldingRow } from '../db/schema';
import { activeLocale } from '../i18n/active-locale';
import { activeHoldings } from '../rates/active-holdings';
import type { RateTable } from '../rates/conversion';
import { sumByCurrency } from '../rates/currency-totals';
import { guardedNetWorth } from '../rates/net-worth-view';

// The snapshot the app writes to the App Group container for the widget to read.
// Its numbers come from the SAME net-worth math the home screen uses (never a
// second computation) so the widget can never disagree with the app.
//
// SECURITY: this file is cleartext JSON in a shared container. It carries the
// MINIMUM the widget actually renders — the formatted total and the per-currency
// breakdown — and nothing else. A 30-day trend series used to be written here
// for a chart the widget no longer draws; it was removed because a wealth
// history on disk widened the exposure for no reader. Do not add a field the
// SwiftUI view does not render. See docs/security/README.md.
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number; formatted: string }[];
  updatedAt: number;
};

export const buildNetWorthSnapshot = (input: {
  holdings: readonly HoldingRow[];
  accounts: readonly Pick<AccountRow, 'id' | 'archivedAt'>[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
}): NetWorthSnapshot => {
  const active = activeHoldings(input.holdings, input.accounts);
  const total = guardedNetWorth(active, input.baseCurrency, input.rateTable, input.now);
  const breakdown = sumByCurrency(active, input.now).map((money) => ({
    currency: money.currency,
    minorUnits: money.minorUnits,
    formatted: formatMoney(money, activeLocale()),
  }));

  return {
    baseCurrency: input.baseCurrency,
    total: { formatted: formatMoney(total, activeLocale()), minorUnits: total.minorUnits },
    breakdown,
    updatedAt: input.now,
  };
};
