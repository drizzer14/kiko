import { guard } from 'fnts';

import type { Currency } from '../../currency/currency';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';

/**
 * NBU's date-RANGE endpoint: one call returns the daily official rate for a
 * single currency across a `[start, end]` span, so a multi-day backfill needs
 * just one request per currency instead of one per day. Auth-free.
 */
const RANGE_ENDPOINT = 'https://bank.gov.ua/NBU_Exchange/exchange_site';

/** One row of the NBU range payload. `rate` is UAH per `units` of `cc`. */
type NbuRangeRow = {
  exchangedate: string;
  r030: number;
  cc: string;
  rate: number;
  units: number;
  rate_per_unit?: number;
};

/** The fiat currencies we source from NBU, mapped to their NBU `valcode`. */
const nbuValcodes: { valcode: string; currency: Currency }[] = [
  { valcode: 'usd', currency: 'USD' },
  { valcode: 'eur', currency: 'EUR' },
];

/**
 * Read an NBU range body, or throw on a non-ok response — a `guard`
 * validator/executor pair rather than an imperative `if (!ok) throw`, matching
 * the CoinGecko and Monobank clients.
 */
const readRange = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`NBU request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<NbuRangeRow[]> => response.json(),
);

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

const rangeUrl = (valcode: string, start: number, end: number): string =>
  `${RANGE_ENDPOINT}?start=${toNbuDate(start)}&end=${toNbuDate(end)}&valcode=${valcode}` +
  `&sort=exchangedate&order=desc&json`;

const toEntry = (currency: Currency, row: NbuRangeRow): HistoryRateEntry => ({
  base: currency,
  quote: 'UAH',
  day: toUtcMidnight(parseNbuDate(row.exchangedate)),
  rate: row.rate_per_unit ?? row.rate / row.units,
  source: 'nbu',
});

/**
 * Fetch official UAH cross rates for USD and EUR over `[start, end]` from NBU's
 * public range endpoint — one request per currency. Returns UAH-per-currency
 * entries per day, ready for the backfill to compose into stored cross pairs.
 * Requests are issued sequentially to stay gentle on the free endpoint.
 */
export const fetchNbuHistory = async (
  start: number,
  end: number,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryRateEntry[]> => {
  const entries: HistoryRateEntry[] = [];
  for (const { valcode, currency } of nbuValcodes) {
    const response = await fetchImpl(rangeUrl(valcode, start, end));
    const rows = await readRange(response);
    for (const row of rows) {
      entries.push(toEntry(currency, row));
    }
  }
  return entries;
};
