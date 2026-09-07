import type { Currency } from '../currency/currency';
import { formatMoney } from '../currency/format';
import type { AccountRow, HoldingRow } from '../db/schema';
import { i18n } from '../i18n';
import { activeLocale } from '../i18n/active-locale';
import { activeHoldings } from '../rates/active-holdings';
import type { RateTable } from '../rates/conversion';
import { guardedBreakdown, guardedNetWorth } from '../rates/net-worth-view';
import type { NetWorthPoint } from '../statistics/net-worth-series';

// The snapshot the app writes to the App Group container for the widget to read.
// Its numbers come from the SAME net-worth math the home screen uses (never a
// second computation) so the widget can never disagree with the app.
export type NetWorthSnapshot = {
  baseCurrency: Currency;
  total: { formatted: string; minorUnits: number };
  breakdown: { currency: Currency; minorUnits: number; formatted: string }[];
  trend: { time: number; value: number }[];
  updatedAt: number;
  // Every user-facing string the widget renders, resolved through `i18n.t` at
  // build time so the widget follows the app's PERSISTED language. The
  // extension runs in a separate process with no JS and no access to the
  // catalogues, and a Localizable.strings bundle would follow the DEVICE
  // language instead — precisely the mismatch this avoids. One entry per
  // string the widget actually renders from a snapshot, no more. Keep in
  // lockstep with `NetWorthSnapshot.Labels` in
  // ios/KikoWidget/NetWorthSnapshot.swift.
  labels: { title: string };
};

export const buildNetWorthSnapshot = (input: {
  holdings: readonly HoldingRow[];
  accounts: readonly Pick<AccountRow, 'id' | 'archivedAt'>[];
  rateTable: RateTable;
  baseCurrency: Currency;
  trendPoints: readonly NetWorthPoint[];
  now: number;
}): NetWorthSnapshot => {
  const active = activeHoldings(input.holdings, input.accounts);
  const total = guardedNetWorth(active, input.baseCurrency, input.rateTable, input.now);
  const breakdown = guardedBreakdown(active, input.baseCurrency, input.rateTable, input.now).map(
    (money) => ({
      currency: money.currency,
      minorUnits: money.minorUnits,
      formatted: formatMoney(money, activeLocale()),
    }),
  );
  const trend = input.trendPoints.map((point) => ({ time: point.t, value: point.amount }));

  return {
    baseCurrency: input.baseCurrency,
    total: { formatted: formatMoney(total, activeLocale()), minorUnits: total.minorUnits },
    breakdown,
    trend,
    updatedAt: input.now,
    labels: { title: i18n.t('home.netWorth') },
  };
};
