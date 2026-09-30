import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { ShareQuoteSource } from '@kiko/holdings/holding-metadata';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

export type ShareSectionProps = {
  quoteSource: ShareQuoteSource;
  onSelectQuoteSource: (quoteSource: ShareQuoteSource) => void;
  ticker: string;
  onChangeTicker: (text: string) => void;
  tickerError?: string;
  tickerFieldRef?: RefObject<FieldInstance | null>;
  tickerInputRef?: RefObject<TextInputInstance | null>;
  // With no saved key, EODHD mode points to Settings instead of hiding the
  // option, so it is never a dead control.
  hasEodhdKey: boolean;
  isin: string;
  onChangeIsin: (text: string) => void;
  isinError?: string;
  isinFieldRef?: RefObject<FieldInstance | null>;
  isinInputRef?: RefObject<TextInputInstance | null>;
  // The first lot is typed only on create; a later buy or sell goes through
  // the Lot form.
  showFirstLot: boolean;
  quantity: string;
  onChangeQuantity: (text: string) => void;
  cost: string;
  onChangeCost: (text: string) => void;
  currencySuffix: string;
  purchaseDate: number;
  onChangePurchaseDate: (timestamp: number) => void;
  quantityError?: string;
  costError?: string;
  quantityFieldRef?: RefObject<FieldInstance | null>;
  quantityInputRef?: RefObject<TextInputInstance | null>;
  costFieldRef?: RefObject<FieldInstance | null>;
  costInputRef?: RefObject<TextInputInstance | null>;
};
