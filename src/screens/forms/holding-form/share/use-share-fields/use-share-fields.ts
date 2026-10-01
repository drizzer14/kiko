import {
  multiplyToDecimal,
  normalizeDecimal,
  shiftDecimal,
  trimDecimal,
} from '@kiko/currency/decimal';
import {
  searchShares,
  lookupShareUnit,
  type ShareListing,
  unitHoldingCurrency,
  type ShareSearchResult,
} from '@kiko/prices/share-search';
import { match } from 'ts-pattern';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { isRecord } from '@kiko/type-guards';
import { startOfLocalDay } from '@kiko/dates';
import { logFailure } from '@kiko/diagnostics';
import either, { bifoldMap } from 'fnts/either';
import { normalizeIsin } from '@kiko/bonds/isin';
import { parseAmount } from '@kiko/currency/parse';
import { holdingsRepo } from '@kiko/holdings/repo';
import { dayKeyOf } from '@kiko/prices/price-book';
import { hasEodhdKey } from '@kiko/prices/eodhd-key';
import type { TextInputInstance } from 'react-native';
import { asLots, type Lot } from '@kiko/holdings/lots';
import { SHARE_PRICE_SCALE } from '@kiko/prices/share-price';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { currencyScale, type Currency } from '@kiko/currency/currency';
import { holdingCurrencyOptions } from '@kiko/holdings/holding-currency';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { asShareMeta, type ShareQuoteSource } from '@kiko/holdings/holding-metadata';

import type {
  CreateCheck,
  EditContext,
  CreatePayload,
  HoldingTypeForm,
} from '../../holding-type-form';

import {
  shareFieldErrors,
  shareReasonKey,
  type ShareFieldErrors,
  type ShareReasonKey,
} from './share-reasons';

const normalizeSymbol = (ticker: string): string => ticker.trim().toUpperCase();

// Only `shareReasonKey` passing lets a create reach here, so a null can only
// be a bug in that gate — never silently a zero quantity.
const normalizedQuantityOrThrow = (quantity: string): string => {
  const normalized = normalizeDecimal(quantity);

  if (normalized === null) {
    throw new Error('Share quantity failed to parse after passing Save validation');
  }

  return normalized;
};

type ShareMetadataFields = {
  quoteSource: ShareQuoteSource;
  ticker: string;
  isin: string;
  quoteCurrency: string | undefined;
  lots: Lot[];
};

// A manual share stores no symbol: the ticker field shows only in EODHD mode.
const shareMetadata = (fields: ShareMetadataFields): Record<string, unknown> => {
  const { quoteSource, ticker, isin, quoteCurrency, lots } = fields;
  const symbol = match(quoteSource)
    .with('eodhd', () => ({ symbol: normalizeSymbol(ticker) }))
    .with('manual', () => ({}))
    .exhaustive();

  return {
    quoteSource,
    ...symbol,
    ...(isin.trim() === '' ? {} : { isin: normalizeIsin(isin) }),
    ...foldMap(maybe(quoteCurrency), (unit) => ({ quoteCurrency: unit })),
    lots,
  };
};

// The cost per share, from the same minor-units cost the lot carries, so the
// two can never disagree.
const firstPrice = (costMinorUnits: number, currency: Currency, quantity: string): string =>
  trimDecimal(
    multiplyToDecimal(
      [shiftDecimal(String(costMinorUnits), -currencyScale[currency])],
      SHARE_PRICE_SCALE,
      quantity,
    ),
  );

type ShareCreateFields = {
  quoteSource: ShareQuoteSource;
  ticker: string;
  isin: string;
  quoteCurrency: string | undefined;
  quantity: string;
  cost: string;
  purchaseDate: number;
  currency: Currency;
};

// A share writes a zero stored balance and one lot. A manual share also
// writes its first price, so it never reads as "no price yet"; an EODHD share
// gets its price from the shared `share:<symbol>` series instead, like a metal.
const buildShareCreatePayload = (fields: ShareCreateFields): CreatePayload => {
  const { quoteSource, ticker, isin, quoteCurrency, quantity, cost, purchaseDate, currency } =
    fields;
  const day = dayKeyOf(purchaseDate);
  const costMinorUnits = Money.fromMajor(currency, parseAmount(cost) || 0).minorUnits;
  const quantityDelta = normalizedQuantityOrThrow(quantity);
  const lots: Lot[] = [{ day, quantityDelta, costMinorUnits }];
  const metadata = shareMetadata({ quoteSource, ticker, isin, quoteCurrency, lots });

  return match(quoteSource)
    .with('eodhd', (): CreatePayload => ({ metadata }))
    .with(
      'manual',
      (): CreatePayload => ({
        metadata,
        firstPricePoint: { day, price: firstPrice(costMinorUnits, currency, quantityDelta) },
      }),
    )
    .exhaustive();
};

// A stored share that no longer parses still has its lots, and the edit that
// repairs it must not write them away. A list with one unreadable entry stops
// the write, since writing over it would drop every readable lot with it.
const storedLots = (storedMetadata: unknown): Lot[] => {
  const lots = asLots((isRecord(storedMetadata) ? storedMetadata.lots : undefined) ?? []);

  if (lots === null) {
    throw new Error('shareEdit: stored lots are unreadable');
  }

  return lots;
};

type QuotedListing = { symbol?: string; quoteCurrency?: string };

// Save waits on this one bounded call only. A lookup that could not run at
// all (a Keychain or database read failed) saves the share as before, the
// same as no key.
const unitAtSave = async (symbol: string): Promise<string | undefined> =>
  bifoldMap(
    await either<unknown, string | undefined>(() => lookupShareUnit(symbol)),
    (error) => {
      logFailure('[share-form] listing unit lookup failed', error);

      return undefined;
    },
    (unit) => unit,
  );

// A provider quote unit belongs to one listing, so it is kept only while the
// ticker still names that listing.
const keptQuoteCurrency = (
  listing: QuotedListing | null,
  quoteSource: ShareQuoteSource,
  ticker: string,
): string | undefined =>
  listing !== null && quoteSource === 'eodhd' && listing.symbol === normalizeSymbol(ticker)
    ? listing.quoteCurrency
    : undefined;

// A typed name or ISIN, or one kept after a pick filled a different one,
// belongs to the user; a pick replaces only a blank one or the one it filled
// last.
const isUserTyped = (value: string, filledValue: string | null): boolean =>
  value.trim() !== '' && value !== filledValue;

type UseShareFieldsParams = {
  type: HoldingType;
  isEdit: boolean;
  currency: Currency;
  name: string;
  setName: (value: string) => void;
  setCurrency: (value: Currency) => void;
  // The screen's own Currency field, which a listing priced in another
  // currency blocks Save on.
  currencyFieldRef: RefObject<FieldInstance | null>;
};

export type UseShareFieldsResult = HoldingTypeForm & {
  // The currency the ticker's listing is priced in, once a pick or a lookup
  // at Save told it: what the Currency field's error asks for.
  listingCurrency: string | undefined;
  // Save shows its spinner only while this one network wait runs.
  isLookingUpUnit: boolean;
  quoteSource: ShareQuoteSource;
  setQuoteSource: (value: ShareQuoteSource) => void;
  ticker: string;
  setTicker: (value: string) => void;
  isin: string;
  setIsin: (value: string) => void;
  quantity: string;
  setQuantity: (value: string) => void;
  cost: string;
  setCost: (value: string) => void;
  purchaseDate: number;
  setPurchaseDate: (timestamp: number) => void;
  hasEodhdKey: boolean;
  search: (query: string) => Promise<ShareSearchResult>;
  pickListing: (listing: ShareListing) => void;
  fieldErrors: ShareFieldErrors;
  reasonKey: ShareReasonKey | null;
  refs: {
    tickerFieldRef: RefObject<FieldInstance | null>;
    isinFieldRef: RefObject<FieldInstance | null>;
    quantityFieldRef: RefObject<FieldInstance | null>;
    costFieldRef: RefObject<FieldInstance | null>;
    tickerInputRef: RefObject<TextInputInstance | null>;
    isinInputRef: RefObject<TextInputInstance | null>;
    quantityInputRef: RefObject<TextInputInstance | null>;
    costInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every share form field: the price source, ticker, ISIN, the first lot
 * (create only), the stored lots carried unchanged through an edit, the
 * per-field validation, and the create/edit writes.
 */
export const useShareFields = (params: UseShareFieldsParams): UseShareFieldsResult => {
  const { type, isEdit, currency, name, setName, setCurrency, currencyFieldRef } = params;

  // Null until the user picks a source or an edit seeds the stored one.
  const [pickedQuoteSource, setQuoteSource] = useState<ShareQuoteSource | null>(null);
  const [ticker, setTicker] = useState('');
  const [isin, setIsin] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => startOfLocalDay(Date.now()));
  const [isEodhdKeySaved, setIsEodhdKeySaved] = useState(false);
  // The listing a pick, or a lookup at Save, last said the ticker names.
  const [quotedListing, setQuotedListing] = useState<QuotedListing | null>(null);
  const [isLookingUpUnit, setIsLookingUpUnit] = useState(false);
  // The name and ISIN the last pick filled in, so the next pick can tell them
  // from ones the user typed.
  const filledNameRef = useRef<string | null>(null);
  const filledIsinRef = useRef<string | null>(null);

  const tickerFieldRef = useRef<FieldInstance>(null);
  const isinFieldRef = useRef<FieldInstance>(null);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const costFieldRef = useRef<FieldInstance>(null);
  const tickerInputRef = useRef<TextInputInstance>(null);
  const isinInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const costInputRef = useRef<TextInputInstance>(null);

  const isShare = type === 'share';

  // Reads only whether a key is saved, never the key, and only once a share
  // is on screen: every other holding type never touches the Keychain.
  useEffect(() => {
    if (isShare) {
      hasEodhdKey().then(setIsEodhdKeySaved, () => setIsEodhdKeySaved(false));
    }
  }, [isShare]);

  // An EODHD share with no saved key never gets a price, so a new share
  // starts manual until a key is found.
  const quoteSource = pickedQuoteSource ?? (isEodhdKeySaved ? 'eodhd' : 'manual');

  const quoteUnit = keptQuoteCurrency(quotedListing, quoteSource, ticker);
  const validation = { isEdit, quoteSource, ticker, quoteUnit, currency, isin, quantity, cost };
  const fieldErrors = shareFieldErrors(validation);
  const reasonKey = shareReasonKey(validation);
  const currencyTarget = { invalid: fieldErrors.currencyError !== null, ref: currencyFieldRef };

  const seed = useCallback((holding: HoldingRow): void => {
    const meta = asShareMeta(holding.metadata);

    if (meta === null) {
      return;
    }

    setQuoteSource(meta.quoteSource);
    setTicker(meta.symbol ?? '');
    setIsin(meta.isin ?? '');
  }, []);

  // An edited share keeps its currency, so only its own listings can be picked.
  const search = (query: string): Promise<ShareSearchResult> =>
    searchShares(query, isEdit ? [currency] : holdingCurrencyOptions('share'));

  const pickListing = (listing: ShareListing): void => {
    setQuotedListing({ symbol: listing.symbol, quoteCurrency: listing.quoteCurrency });
    setTicker(listing.symbol);
    setCurrency(listing.currency);

    if (!isUserTyped(isin, filledIsinRef.current)) {
      filledIsinRef.current = listing.isin ?? '';
      setIsin(listing.isin ?? '');
    }

    if (!isUserTyped(name, filledNameRef.current)) {
      filledNameRef.current = listing.name;
      setName(listing.name);
    }
  };

  const createPayloadWith = (quoteCurrency: string | undefined): CreatePayload =>
    buildShareCreatePayload({
      quoteSource,
      ticker,
      isin,
      quoteCurrency,
      quantity,
      cost,
      purchaseDate,
      currency,
    });

  const createPayload = (): CreatePayload => createPayloadWith(quoteUnit);

  // A hand-typed EODHD ticker's unit is looked up once, with the call its
  // first refresh would spend, and stored, so that refresh spends none. A
  // unit the chosen currency does not fit blocks Save on the Currency field.
  const checkCreate = async (): Promise<CreateCheck> => {
    if (quoteSource !== 'eodhd' || quoteUnit !== undefined) {
      return { kind: 'save', payload: createPayload() };
    }

    const symbol = normalizeSymbol(ticker);

    setIsLookingUpUnit(true);

    const unit = await unitAtSave(symbol);

    setIsLookingUpUnit(false);

    if (unit === undefined) {
      return { kind: 'save', payload: createPayload() };
    }

    setQuotedListing({ symbol, quoteCurrency: unit });

    if (unitHoldingCurrency(unit) !== currency) {
      return { kind: 'blocked', target: { invalid: true, ref: currencyFieldRef } };
    }

    return { kind: 'save', payload: createPayloadWith(unit) };
  };

  // The lots and the quote unit come from the row stored at the time of the
  // write: the price refresh can store the unit while the form is open.
  const saveEdit = (context: EditContext): Promise<void> =>
    holdingsRepo.updateShareFromStored(
      context.holdingId,
      { name: context.name, color: context.color },
      (storedMetadata) => {
        const storedAtWrite = asShareMeta(storedMetadata);

        return shareMetadata({
          quoteSource,
          ticker,
          isin,
          quoteCurrency: quoteUnit ?? keptQuoteCurrency(storedAtWrite, quoteSource, ticker),
          lots: storedLots(storedMetadata),
        });
      },
    );

  return {
    quoteSource,
    setQuoteSource,
    ticker,
    setTicker,
    isin,
    setIsin,
    quantity,
    setQuantity,
    cost,
    setCost,
    purchaseDate,
    setPurchaseDate,
    hasEodhdKey: isEodhdKeySaved,
    search,
    pickListing,
    listingCurrency: foldMap(maybe(quoteUnit), unitHoldingCurrency),
    isLookingUpUnit,
    fieldErrors,
    reasonKey,
    isValid: reasonKey === null,
    scrollTargets: [
      currencyTarget,
      {
        invalid: fieldErrors.tickerError !== null,
        ref: tickerFieldRef,
        focus: () => tickerInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.isinError !== null,
        ref: isinFieldRef,
        focus: () => isinInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.quantityError !== null,
        ref: quantityFieldRef,
        focus: () => quantityInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.costError !== null,
        ref: costFieldRef,
        focus: () => costInputRef.current?.focus(),
      },
    ],
    createPayload,
    checkCreate,
    saveEdit,
    seed,
    refs: {
      tickerFieldRef,
      isinFieldRef,
      quantityFieldRef,
      costFieldRef,
      tickerInputRef,
      isinInputRef,
      quantityInputRef,
      costInputRef,
    },
  };
};
