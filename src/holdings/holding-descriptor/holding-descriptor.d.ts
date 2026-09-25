import type { TFunction } from 'i18next';

import type { Lot } from '../lots';
import type { HoldingRow } from '../../db/schema';
import type { PricedHolding } from '../priced-value';
import type { DerivedEntry } from '../derived-entries';
import type { Currency } from '../../currency/currency';
import type { PriceBook } from '../../prices/price-book';
import type { ExchangeReceivePath } from '../exchange-destination';
import type { HoldingValueBreakdown, ValuableHolding } from '../holding-value';

export type IdentifiedHolding = ValuableHolding & { id: string };

/** How a PriceBook-valued type is priced. */
export type PricedSpec = {
  lots: (metadata: HoldingRow['metadata']) => readonly Lot[] | undefined;
  /** Minor units at `instant`, or null without a price point; `id` is already checked. */
  valueMinor: (
    holding: PricedHolding & { id: string },
    book: PriceBook,
    instant: number,
  ) => number | null;
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
  entries: (holding: IdentifiedHolding, now: number, t: TFunction) => readonly DerivedEntry[];
};
