import type { TFunction } from 'i18next';

import type { Lot } from '../lots';
import type { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
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
  /** The series the "as of" caption reads; null for unparsable metadata. */
  captionInstrument: (holding: HoldingRow) => string | null;
  captionKey: 'holdingDetail.priceAsOf' | 'holdingDetail.valueAsOf';
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
