import { createHmac } from 'node:crypto';

import {
  fetchDepositPage,
  fetchFundingLedgerPage,
  fetchInternalDepositPage,
  fetchLogPage,
  fetchTransferPage,
  fetchWithdrawalPage,
} from './bybit.history-client';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { SPAN, optionsOf, pageAnswer } from './bybit.history-test-fixtures';

const ROUTES = [
  ['the Unified transaction log', fetchLogPage, 'list'],
  ['the capital deposits', fetchDepositPage, 'rows'],
  ['the internal deposits', fetchInternalDepositPage, 'rows'],
  ['the withdrawals', fetchWithdrawalPage, 'rows'],
  ['the transfers', fetchTransferPage, 'list'],
  ['the funding ledger', fetchFundingLedgerPage, 'list'],
] as const;

const CURSORS = [
  ['a percent-encoded token', '21963%3A1%2C14954%3A1'],
  ['a base64 token ending in =', 'eyJhIjoxfQ=='],
  ['a base64 token holding + and /', 'ab+c/d='],
] as const;

// HMAC-SHA256 by Node's own implementation, so the expectation does not share code with the client.
const signatureOf = (text: string): string =>
  createHmac('sha256', SECRET).update(text).digest('hex');

const sentWith = async (
  fetchPage: (typeof ROUTES)[number][1],
  field: 'rows' | 'list',
  cursor: string | undefined,
) => {
  const { fetchImpl, sent } = pageAnswer(field, []);

  await fetchPage(API_KEY, SECRET, { span: SPAN, cursor }, optionsOf(fetchImpl));

  const [request] = sent;
  const [, query = ''] = request.url.split('?');

  return { request, query };
};

const withoutCursor = (query: string): string[] =>
  query.split('&').filter((part) => !part.startsWith('cursor='));

describe.each(ROUTES)('the page cursor of %s', (_title, fetchPage, field) => {
  it.each(CURSORS)(
    'sends %s verbatim in the one query that is signed and sent',
    async (_name, token) => {
      const { request, query } = await sentWith(fetchPage, field, token);

      expect(query.split('&')).toContain(`cursor=${token}`);
      expect(request.init.headers['X-BAPI-SIGN']).toBe(
        signatureOf(`${NOW}${API_KEY}5000${query}`),
      );
    },
  );

  it('leaves every other parameter exactly as the first page sends it', async () => {
    const first = await sentWith(fetchPage, field, undefined);
    const second = await sentWith(fetchPage, field, 'eyJhIjoxfQ==');

    expect(first.query).not.toContain('cursor');
    expect(withoutCursor(second.query)).toEqual(first.query.split('&'));
  });
});

describe('the parameters of the Unified transaction log with a cursor', () => {
  it('still sends the account type, the span and the page of 50', async () => {
    const { query } = await sentWith(fetchLogPage, 'list', 'eyJhIjoxfQ==');

    expect(withoutCursor(query)).toEqual([
      'accountType=UNIFIED',
      `startTime=${SPAN.start}`,
      `endTime=${SPAN.end}`,
      'limit=50',
    ]);
  });
});
