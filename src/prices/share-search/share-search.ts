import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';
import { type Currency, isCurrency } from '@kiko/currency/currency';

import { readEodhdKey } from '../eodhd-key';
import { reserve, settle, currentQuota, type QuoteQuota } from '../quote-quota';
import { searchSymbols, EodhdQuotaError, EodhdNetworkError, type SymbolMatch } from '../eodhd';

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
  | { status: 'noKey' | 'quotaExhausted' | 'failed' };

export type ShareSearchDeps = {
  now?: () => number;
  readKey?: () => Promise<string | undefined>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  searchSymbols?: typeof searchSymbols;
};

const holdingCurrencyOf = (unit: string): string => (unit === PENCE ? 'GBP' : unit);

const toListing =
  (currencies: readonly Currency[]) =>
  ({ symbol, name, isin, currency: unit }: SymbolMatch): ShareListing[] => {
    const currency = holdingCurrencyOf(unit);

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
  updateQuota: settingsRepo.updateQuoteQuota,
  searchSymbols,
  ...deps,
});

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
  const { now, readKey, updateQuota, ...network } = withDefaults(deps);
  const key = await readKey();

  if (key === undefined) {
    return { status: 'noKey' };
  }

  const day = await reserveCall(updateQuota, now());

  if (day === undefined) {
    return { status: 'quotaExhausted' };
  }

  const found = await either(async () => network.searchSymbols(query.trim(), key));

  if (isLeft(found)) {
    const error: unknown = bifold(found);
    const usedUp = error instanceof EodhdQuotaError;

    // Only the error's name: the request URL carries the key, the query is
    // the user's own portfolio.
    logFailure('[share-search] EODHD search failed', error);
    await updateQuota((stored) =>
      settle(stored, {
        day,
        reserved: 1,
        spent: error instanceof EodhdNetworkError ? 0 : 1,
        unanswered: [],
        usedUp,
      }),
    );

    return { status: usedUp ? 'quotaExhausted' : 'failed' };
  }

  const matches: SymbolMatch[] = bifold(found);
  const primaryFirst = [...matches].sort(
    (first, second) => Number(second.isPrimary) - Number(first.isPrimary),
  );

  return { status: 'ok', listings: primaryFirst.flatMap(toListing(currencies)) };
};
