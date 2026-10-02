import { match, P } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';
import { type Currency, isCurrency } from '@kiko/currency/currency';
import { holdingCurrencyOptions } from '@kiko/holdings/holding-currency';

import {
  searchSymbols,
  EodhdAuthError,
  EodhdQuotaError,
  EodhdNetworkError,
  type SymbolMatch,
} from '../eodhd';
import { readEodhdKey } from '../eodhd-key';
import { reserve, settle, currentQuota, type QuoteQuota, keyGenerationOf } from '../quote-quota';

const PENCE = 'GBX';

/**
 * A listing the share form can hold: `currency` is the holding's currency and
 * `quoteCurrency` the unit EODHD prices it in (`GBX` pence for a `GBP` holding).
 */
export type ShareListing = {
  symbol: string;
  name: string;
  isin?: string;
  currency: Currency;
  quoteCurrency: string;
};

export type ShareSearchResult =
  | { status: 'ok'; listings: ShareListing[] }
  | { status: 'noKey' | 'keyRejected' | 'quotaExhausted' | 'failed' };

export type ShareSearchDeps = {
  now?: () => number;
  readKey?: () => Promise<string | undefined>;
  loadQuota?: () => Promise<QuoteQuota | null>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  searchSymbols?: typeof searchSymbols;
};

export type ListingSearch = { code: string; exchange: string };

/**
 * The holding currency a listing's price unit fits: a pence (`GBX`) close is
 * a pound holding's, every other unit only its own currency's. A share whose
 * currency is not this one is never priced.
 */
export const unitHoldingCurrency = (unit: string): string => (unit === PENCE ? 'GBP' : unit);

/**
 * Whether a share can be held in the currency a listing's unit fits. A unit
 * with no such currency (`ZAC` cents, `ILA` agorot) is never priced, whatever
 * currency the share is in.
 */
export const isShareUnitSupported = (unit: string): boolean => {
  const currency = unitHoldingCurrency(unit);

  return isCurrency(currency) && holdingCurrencyOptions('share').includes(currency);
};

const toListing =
  (currencies: readonly Currency[]) =>
  ({ symbol, name, isin, currency: unit }: SymbolMatch): ShareListing[] => {
    const currency = unitHoldingCurrency(unit);

    if (!isCurrency(currency) || !currencies.includes(currency)) {
      return [];
    }

    return [
      {
        symbol,
        name,
        ...foldMap(maybe(isin), (found) => ({ isin: found })),
        currency,
        quoteCurrency: unit,
      },
    ];
  };

// A search is the user waiting on a sheet, so it may spend the calls a
// refresh leaves for it, up to the daily limit itself.
const reserveCall = async (
  updateQuota: Required<ShareSearchDeps>['updateQuota'],
  now: number,
): Promise<number | undefined> => {
  let reservedDay: number | undefined;

  await updateQuota((stored) => {
    const quota = currentQuota(stored, now);

    if (quota.calls >= quota.dailyLimit) {
      return stored;
    }

    reservedDay = quota.day;

    return reserve(quota, 1, []);
  });

  return reservedDay;
};

const withDefaults = (deps: ShareSearchDeps): Required<ShareSearchDeps> => ({
  now: Date.now,
  readKey: readEodhdKey,
  loadQuota: async () => (await settingsRepo.quoteQuotaQuery()).at(0)?.quoteQuota ?? null,
  updateQuota: settingsRepo.updateQuoteQuota,
  searchSymbols,
  ...deps,
});

type SearchRequest = { query: string; exchange?: string; timeoutMs?: number };

type QuotaSearch =
  | { status: 'ok'; matches: SymbolMatch[] }
  | { status: 'noKey' | 'keyRejected' | 'quotaExhausted' | 'failed' };

// One search call under the user's own daily EODHD limit, reserved before it
// goes out. A key EODHD rejected spends nothing until a key is saved or
// checked again.
const searchUnderQuota = async (
  request: SearchRequest,
  deps: ShareSearchDeps,
): Promise<QuotaSearch> => {
  const { now, readKey, loadQuota, updateQuota, ...network } = withDefaults(deps);
  // The key state is read before the key, so a 401 never lands on a key saved
  // in between.
  const loaded = await loadQuota();

  if (loaded?.isKeyRejected === true) {
    return { status: 'keyRejected' };
  }

  const key = await readKey();

  if (key === undefined) {
    return { status: 'noKey' };
  }

  const day = await reserveCall(updateQuota, now());

  if (day === undefined) {
    return { status: 'quotaExhausted' };
  }

  const found = await either(async () =>
    network.searchSymbols(request.query, key, undefined, request.exchange, request.timeoutMs),
  );

  if (isLeft(found)) {
    const error: unknown = bifold(found);
    const status = match(error)
      .with(P.instanceOf(EodhdQuotaError), () => 'quotaExhausted' as const)
      .with(P.instanceOf(EodhdAuthError), () => 'keyRejected' as const)
      .otherwise(() => 'failed' as const);

    // Only the error's name: the request URL carries the key, the query is
    // the user's own portfolio.
    logFailure('[share-search] EODHD search failed', error);
    await updateQuota((stored) =>
      settle(stored, {
        day,
        reserved: 1,
        spent: error instanceof EodhdNetworkError ? 0 : 1,
        unanswered: [],
        usedUp: status === 'quotaExhausted',
        keyGeneration: keyGenerationOf(loaded),
        isKeyRejected: status === 'keyRejected',
      }),
    );

    return { status };
  }

  return { status: 'ok', matches: bifold(found) };
};

/**
 * Finds the listings for a ticker, a name, or an ISIN under the user's own
 * daily EODHD limit: one call per search, reserved before it goes out. Only
 * listings a share holding can take in one of `currencies` come back, the
 * primary listings first.
 */
export const searchShares = async (
  query: string,
  currencies: readonly Currency[],
  deps: ShareSearchDeps = {},
): Promise<ShareSearchResult> => {
  const found = await searchUnderQuota({ query: query.trim() }, deps);

  if (found.status !== 'ok') {
    return found;
  }

  const primaryFirst = [...found.matches].sort(
    (first, second) => Number(second.isPrimary) - Number(first.isPrimary),
  );

  return { status: 'ok', listings: primaryFirst.flatMap(toListing(currencies)) };
};

// A user waits on a pressed Save for this one, so it gives up sooner than a
// refresh does; an unanswered request costs no call either way.
const SAVE_LOOKUP_TIMEOUT_MS = 10_000;

/** The search a `CODE.EXCHANGE` symbol's unit is looked up with: its code, on its exchange. */
export const listingSearchOf = (symbol: string): ListingSearch | undefined => {
  const dot = symbol.lastIndexOf('.');

  if (dot <= 0 || dot === symbol.length - 1) {
    return undefined;
  }

  return { code: symbol.slice(0, dot), exchange: symbol.slice(dot + 1) };
};

/**
 * The unit EODHD prices one `CODE.EXCHANGE` listing in, with the same one
 * search call the share refresh would spend on it, under the same limit as a
 * search. Undefined when the search could not run or found no listing of
 * exactly that name.
 */
export const lookupShareUnit = async (
  symbol: string,
  deps: ShareSearchDeps = {},
): Promise<string | undefined> => {
  const search = listingSearchOf(symbol);

  if (search === undefined) {
    return undefined;
  }

  const found = await searchUnderQuota(
    { query: search.code, exchange: search.exchange, timeoutMs: SAVE_LOOKUP_TIMEOUT_MS },
    deps,
  );

  if (found.status !== 'ok') {
    return undefined;
  }

  return found.matches.find((candidate) => candidate.symbol === symbol)?.currency;
};
