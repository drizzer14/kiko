import type { TFunction } from 'i18next';
import type { HoldingRow } from '@kiko/db';

import type { Lot } from '../lots';
import type { Money } from '../../currency/money';
import type { OwnershipShare } from '../ownership';
import type { PricedHolding } from '../priced-value';
import type { DerivedEntry } from '../derived-entries';
import type { Currency } from '../../currency/currency';
import type { PriceBook } from '../../prices/price-book';
import type { ExchangeReceivePath } from '../exchange-destination';
import type { HoldingValueBreakdown, ValuableHolding } from '../holding-value';

/** How a PriceBook-valued type is priced. */
export type PricedSpec = {
  lots: (metadata: HoldingRow['metadata']) => readonly Lot[] | undefined;
  /**
   * The Money value at `instant`, in the spec's own currency — NOT
   * necessarily `holding.currency` (`property_item` returns the holding
   * currency; `metal` returns the price point row's own currency, which NBU
   * always stores as UAH) — or null without a price point.
   */
  value: (holding: PricedHolding, book: PriceBook, instant: number) => Money | null;
  /**
   * The share of the whole asset the user owns at `instant`; the value and
   * the cost basis are both scaled by it. Absent owns the whole asset.
   */
  share?: (metadata: HoldingRow['metadata'], instant: number) => OwnershipShare;
};

/** Everything the domain decides per holding type. */
export type HoldingDescriptor = {
  symbol: string;
  defaultColor: string;
  /** A debt reads negative and stays out of the asset breakdown. */
  side: 'asset' | 'debt';
  /** Writes no manual ledger rows; value derives from metadata. */
  ledgerless: boolean;
  /** Ledger rows show the date only. */
  timeExempt: boolean;
  /** The only currency this type may hold, or null for any. */
  fixedCurrency: Currency | null;
  exchange: {
    receivePath: ExchangeReceivePath;
    source: boolean;
    createSource: boolean;
    createDestination: boolean;
  };
  priced: PricedSpec | null;
  breakdown: (holding: ValuableHolding, now: number, book: PriceBook) => HoldingValueBreakdown;
  entries: (holding: ValuableHolding, now: number, t: TFunction) => readonly DerivedEntry[];
};
