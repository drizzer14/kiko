import { DAY_MS } from '@kiko/dates';
import { i18n } from '@kiko/i18n/init';
import either, { bifold, bifoldr, isLeft } from 'fnts/either';

import {
  type BybitKeyInfo,
  type BybitReadOptions,
  fetchFundBalance,
  fetchKeyInfo,
  fetchUnifiedBalance,
} from './bybit.client';
import {
  BybitHistoryParseError,
  fetchConvertPage,
  fetchDepositPage,
  fetchFundingLedgerPage,
  fetchInternalDepositPage,
  fetchLogPage,
  fetchTransferPage,
  fetchWithdrawalPage,
} from './bybit.history-client';
import { bybitConnectFailureText } from './bybit.failure-text';

type RouteRead = (apiKey: string, secret: string, options: BybitReadOptions) => Promise<unknown>;

/**
 * One real read of each shipped route: the two balances, then each history route. A history read
 * asks for one row of the last day, and the convert read for its first row, so the connect costs
 * a short answer from each route and starts no walk.
 */
const routeReadsAt = (now: number): RouteRead[] => {
  const oneRow = { span: { start: now - DAY_MS, end: now }, cursor: undefined, limit: 1 };

  return [
    fetchUnifiedBalance,
    fetchFundBalance,
    (apiKey, secret, options) => fetchDepositPage(apiKey, secret, oneRow, options),
    (apiKey, secret, options) => fetchInternalDepositPage(apiKey, secret, oneRow, options),
    (apiKey, secret, options) => fetchWithdrawalPage(apiKey, secret, oneRow, options),
    (apiKey, secret, options) => fetchTransferPage(apiKey, secret, oneRow, options),
    (apiKey, secret, options) => fetchLogPage(apiKey, secret, oneRow, options),
    (apiKey, secret, options) => fetchConvertPage(apiKey, secret, { index: 1, limit: 1 }, options),
    (apiKey, secret, options) => fetchFundingLedgerPage(apiKey, secret, oneRow, options),
  ];
};

/**
 * The text of the first route the key cannot read, or `undefined`. A route that answers in a shape
 * this client cannot parse still answered the key: only a refusal, or a request that failed, stops
 * the connect.
 */
const routeRefusalOf = async (
  reads: RouteRead[],
  apiKey: string,
  secret: string,
  options: BybitReadOptions,
): Promise<string | undefined> => {
  const [read, ...rest] = reads;

  if (read === undefined) {
    return undefined;
  }

  const attempt = await either<unknown, unknown>(() => read(apiKey, secret, options));

  if (isLeft(attempt)) {
    const error: unknown = bifold(attempt);

    if (!(error instanceof BybitHistoryParseError)) {
      return bybitConnectFailureText(error);
    }
  }

  return routeRefusalOf(rest, apiKey, secret, options);
};

/**
 * The text that refuses a key at connect, or `undefined` when the key may be stored. The order
 * is fixed: the key read, then a key that can do more than read, then a key that is no main key,
 * then one read of each shipped route. Each refusal stops the connect at the call that found it,
 * so a refused key costs a few calls and no write.
 */
export const bybitKeyRefusalOf = async (
  apiKey: string,
  secret: string,
  options: BybitReadOptions = {},
): Promise<string | undefined> => {
  const keyRead = await either<unknown, BybitKeyInfo>(() => fetchKeyInfo(apiKey, secret, options));

  if (isLeft(keyRead)) {
    return bybitConnectFailureText(bifold(keyRead));
  }

  const { readOnly, isMaster } = bifoldr(keyRead);

  if (readOnly !== 1) {
    return i18n.t('accountDetail.bybitKeyNotReadOnly');
  }

  if (isMaster !== true) {
    return i18n.t('accountDetail.bybitKeyNotMain');
  }

  return routeRefusalOf(routeReadsAt((options.now ?? Date.now)()), apiKey, secret, options);
};
