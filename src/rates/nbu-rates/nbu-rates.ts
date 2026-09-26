import { guard } from 'fnts';
import { NBU_API_ENDPOINT } from '@env';

import type { RateEntry } from '../conversion';
import { isCurrency, isFiat } from '../../currency/currency';

/**
 * NBU's public, tokenless CURRENT-rate endpoint — one request returns every
 * currency NBU prices against UAH today. UNPINNED (see
 * `ios/Kiko/Info.plist`'s `NSPinnedDomains`): the live, unpinned fallback
 * fiat source `rates-refresh.ts` reaches for when the cert-pinned Monobank
 * host is unreachable. Sibling to `nbu-history.ts`'s date-RANGE endpoint,
 * which this is NOT — that one serves one currency's history over a span,
 * this one serves every currency for a single (today's) date. The host
 * (`NBU_API_ENDPOINT`) is shared config; this path is specific to this call.
 */
const EXCHANGE_ENDPOINT = `${NBU_API_ENDPOINT}/NBUStatService/v1/statdirectory/exchange?json`;

/**
 * One row of the current-rate payload. `rate` is UAH per `units` of `cc`
 * (an ISO 4217 alpha code, matching our own `Currency` literals directly —
 * unlike the range endpoint, this feed has never been observed to include
 * `units`, but a defensive divide keeps a future rate-per-N-units row correct
 * rather than silently over-pricing that currency by a factor of `units`).
 */
type NbuExchangeRow = {
  r030: number;
  txt: string;
  rate: number;
  cc: string;
  exchangedate: string;
  units?: number;
};

/**
 * Read an NBU exchange body, or throw on a non-ok response — a `guard`
 * validator/executor pair, matching `nbu-history.ts`'s range-endpoint reader.
 */
const readExchange = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`NBU request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<NbuExchangeRow[]> => response.json(),
);

const toRateEntry = (row: NbuExchangeRow): RateEntry[] => {
  if (!isCurrency(row.cc) || !isFiat(row.cc)) {
    return [];
  }
  const units = row.units ?? 1;
  if (!Number.isFinite(row.rate) || units <= 0) {
    return [];
  }
  return [{ base: row.cc, quote: 'UAH', rate: row.rate / units, source: 'nbu' }];
};

/**
 * Fetch NBU's official CURRENT UAH cross rates for every currency our app
 * also supports. Used as `rates-refresh.ts`'s unpinned fallback fiat source
 * when Monobank's cert-pinned `/bank/currency` is unreachable after every
 * retry — NBU quotes fewer currencies than Monobank, which is fine, the
 * bundled seed (`fiat-rate-seed.ts`) still covers the rest.
 */
export const fetchNbuFiatRates = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(EXCHANGE_ENDPOINT);
  const rows = await readExchange(response);
  return rows.flatMap(toRateEntry);
};
