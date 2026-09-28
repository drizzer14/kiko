import { guard } from 'fnts';
import { NBU_API_ENDPOINT } from '@env';
import either, { bifoldr } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import { createRequestGate } from '@kiko/monobank/throttle';

import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';

/**
 * NBU's date-RANGE endpoint: one call returns the daily official rate for a
 * single currency across a `[start, end]` span, so a multi-day backfill needs
 * just one request per currency instead of one per day. Auth-free. The host
 * (`NBU_API_ENDPOINT`) is shared config; this path is specific to this call.
 */
const RANGE_ENDPOINT = `${NBU_API_ENDPOINT}/NBU_Exchange/exchange_site`;

/**
 * NBU documents no rate limit for this endpoint, but requests still run
 * SEQUENTIALLY, spaced by this interval (kiko-pricing's "History backfill"),
 * to stay gentle on a free, keyless host.
 */
export const NBU_HISTORY_REQUEST_INTERVAL_MS = 250;

/** One row of the NBU range payload. `rate` is UAH per `units` of `cc`. */
type NbuRangeRow = {
  exchangedate: string;
  r030: number;
  cc: string;
  rate: number;
  units: number;
  rate_per_unit?: number;
};

/**
 * One `fetchNbuHistory` answer: every answering currency's entries, plus the
 * currencies whose OWN range request failed — settled independently, so one
 * currency's HTTP failure never discards another's already-fetched rows.
 */
export type NbuHistory = { entries: HistoryRateEntry[]; failedCurrencies: Currency[] };

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

/** One row -> zero or one entry: a broken row (no units, a non-finite or non-positive rate) is dropped, never stored. */
const toEntry = (currency: Currency, row: NbuRangeRow): HistoryRateEntry[] => {
  if (row.units <= 0) {
    return [];
  }

  const rate = row.rate_per_unit ?? row.rate / row.units;

  if (!Number.isFinite(rate) || rate <= 0) {
    return [];
  }

  return [
    {
      base: currency,
      quote: 'UAH',
      day: toUtcMidnight(parseNbuDate(row.exchangedate)),
      rate,
      source: 'nbu',
    },
  ];
};

/**
 * Fetch official UAH cross rates for every fiat currency in `currencies` over
 * `[start, end]` from NBU's public range endpoint — one request per currency,
 * settled independently (a single currency's HTTP failure is recorded in
 * `failedCurrencies`, never discarding the others' rows), never a nobody-holds
 * request (kiko-architecture: no request for data the user does not have).
 * Requests are SEQUENTIAL, spaced by `NBU_HISTORY_REQUEST_INTERVAL_MS` through
 * a per-call `RequestGate`, to stay gentle on the free endpoint. This function
 * never rejects.
 */
export const fetchNbuHistory = async (
  currencies: readonly Currency[],
  start: number,
  end: number,
  deps: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<NbuHistory> => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const gate = createRequestGate({ intervalMs: NBU_HISTORY_REQUEST_INTERVAL_MS, now, sleep });

  const entries: HistoryRateEntry[] = [];
  const failedCurrencies: Currency[] = [];

  for (const currency of currencies) {
    await gate.wait();

    const rows = bifoldr(
      await either<Error, NbuRangeRow[]>(async () => {
        const response = await fetchImpl(rangeUrl(currency.toLowerCase(), start, end));

        return readRange(response);
      }),
    );

    if (rows === undefined) {
      failedCurrencies.push(currency);
      continue;
    }

    for (const row of rows) {
      entries.push(...toEntry(currency, row));
    }
  }

  return { entries, failedCurrencies };
};
