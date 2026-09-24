import { guard } from 'fnts';
import maybe, { foldMap } from 'fnts/maybe';

import { decimalFromJsonNumber } from '../../currency/decimal';
import { type Metal, preciousMetals } from '../../holdings/holding-metadata';

/**
 * NBU's public, tokenless CURRENT-rate endpoint — the SAME URL
 * `nbu-rates.ts`'s `EXCHANGE_ENDPOINT` reads for fiat. One call's payload
 * carries every precious metal this app prices (XAU/XAG/XPT/XPD) alongside
 * every fiat currency, so a dedicated metals endpoint is never needed for
 * "today's" price. Deliberately UNPINNED (`ios/Kiko/Info.plist`'s
 * `NSPinnedDomains`), keyless, public — same host as `nbu-rates.ts`/
 * `nbu-history.ts`.
 */
const EXCHANGE_ENDPOINT = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';

/**
 * NBU's date-RANGE endpoint — the SAME URL `nbu-history.ts`'s
 * `RANGE_ENDPOINT` reads for USD/EUR. One call returns a single metal's
 * daily official UAH price across a `[start, end]` span, auth-free.
 */
const RANGE_ENDPOINT = 'https://bank.gov.ua/NBU_Exchange/exchange_site';

/**
 * One row of the current-rate payload for a precious metal. Unlike a fiat
 * row (`nbu-rates.ts`'s `NbuExchangeRow`), a metal row has never been
 * observed to carry a `units` divisor — `rate` is UAH per troy ounce
 * directly.
 */
type NbuCurrentMetalRow = { cc: string; rate: number };

/** One row of the range payload for a single metal. `rate` is UAH per `units` troy ounces. */
type NbuRangeMetalRow = {
  exchangedate: string;
  cc: string;
  rate: number;
  units: number;
  rate_per_unit?: number;
};

/** One resolved NBU metal price, in UAH — a decimal string, never a float. */
export type NbuMetalRate = { metal: Metal; price: string };

/** One resolved NBU metal price for a specific calendar day. */
export type NbuMetalHistoryPoint = NbuMetalRate & { day: number };

const isMetal = (value: string): value is Metal =>
  (preciousMetals as readonly string[]).includes(value);

/**
 * Read an NBU current-rate body, or throw on a non-ok response — a `guard`
 * validator/executor pair, matching `nbu-rates.ts`/`nbu-history.ts`.
 */
const readCurrent = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`NBU request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<NbuCurrentMetalRow[]> => response.json(),
);

/** Read an NBU range body, or throw on a non-ok response — mirrors `readCurrent` above. */
const readRange = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`NBU request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<NbuRangeMetalRow[]> => response.json(),
);

const toCurrentRate = (row: NbuCurrentMetalRow): NbuMetalRate[] => {
  if (!isMetal(row.cc)) {
    return [];
  }

  const price = decimalFromJsonNumber(row.rate);

  return foldMap(maybe(price), (found) => [{ metal: row.cc, price: found }]) ?? [];
};

/**
 * Fetch NBU's official CURRENT UAH price for every precious metal this app
 * prices (XAU/XAG/XPT/XPD), from the SAME current-exchange payload
 * `nbu-rates.ts` reads for fiat — one request answers both. `metal-refresh.ts`
 * assigns the resulting points to "today"'s local day; this feed carries no
 * day dimension of its own to read back.
 */
export const fetchNbuMetalsCurrent = async (
  fetchImpl: typeof fetch = fetch,
): Promise<NbuMetalRate[]> => {
  const response = await fetchImpl(EXCHANGE_ENDPOINT);
  const rows = await readCurrent(response);

  return rows.flatMap(toCurrentRate);
};

/** Format a UTC-midnight instant as NBU's `YYYYMMDD` date parameter. */
const toNbuDate = (ms: number): string => {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/** Parse NBU's `DD.MM.YYYY` `exchangedate` into a UTC-midnight epoch-ms day. */
const parseNbuDate = (value: string): number => {
  const [day, month, year] = value.split('.').map(Number);
  return Date.UTC(year, month - 1, day);
};

const rangeUrl = (metal: Metal, start: number, end: number): string =>
  `${RANGE_ENDPOINT}?start=${toNbuDate(start)}&end=${toNbuDate(end)}&valcode=${metal.toLowerCase()}` +
  `&sort=exchangedate&order=desc&json`;

const toHistoryPoint = (metal: Metal, row: NbuRangeMetalRow): NbuMetalHistoryPoint[] => {
  const price = decimalFromJsonNumber(row.rate_per_unit ?? row.rate / row.units);

  return (
    foldMap(maybe(price), (found) => [
      { metal, day: parseNbuDate(row.exchangedate), price: found },
    ]) ?? []
  );
};

/**
 * Fetch one metal's official UAH price history over `[start, end]` from
 * NBU's public range endpoint — one request per metal, mirroring
 * `nbu-history.ts`'s USD/EUR fetch. Used for the one-time backfill from a
 * metal holding's earliest lot day (`metal-refresh.ts`).
 */
export const fetchNbuMetalHistory = async (
  metal: Metal,
  start: number,
  end: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NbuMetalHistoryPoint[]> => {
  const response = await fetchImpl(rangeUrl(metal, start, end));
  const rows = await readRange(response);

  return rows.flatMap((row) => toHistoryPoint(metal, row));
};
