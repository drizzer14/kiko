import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import { NOW, answerWith, envelopeOf } from './bybit.client-test-fixtures';

export const SPAN: WalkWindow = { start: 1_741_000_000_000, end: 1_743_000_000_000 };

// A value in a field the client must never read: a test looks for it in what the client gives back.
export const NEVER_READ = 'SENTINEL-NEVER-READ';

// Each row keeps the field words and the sample values of its page (deposit: amount "999.0496",
// status 3, successAt "1742728163000", depositType "0"; internal deposit: createdTime
// "1705393280"; withdrawal: amount "41.43008", status "success"; transfer: amount "5000", SPOT to
// UNIFIED, status "SUCCESS"). The values the page does not give are built.
export const depositRow = (overrides: Record<string, unknown> = {}) => ({
  id: '1234',
  coin: 'USDT',
  chain: 'ETH',
  amount: '999.0496',
  status: 3,
  toAddress: NEVER_READ,
  tag: NEVER_READ,
  depositFee: '',
  successAt: '1742728163000',
  confirmations: '',
  blockHash: NEVER_READ,
  batchReleaseLimit: '-1',
  depositType: '0',
  fromAddress: NEVER_READ,
  ...overrides,
});

export const internalDepositRow = (overrides: Record<string, unknown> = {}) => ({
  id: '5678',
  type: 1,
  coin: 'USDT',
  amount: '12.5',
  status: 2,
  address: NEVER_READ,
  createdTime: '1705393280',
  fromMemberId: NEVER_READ,
  complianceStatus: NEVER_READ,
  ...overrides,
});

export const withdrawalRow = (overrides: Record<string, unknown> = {}) => ({
  withdrawId: '9012',
  withdrawType: 0,
  coin: 'USDT',
  chain: 'ETH',
  amount: '41.43008',
  withdrawFee: '5',
  status: 'success',
  toAddress: NEVER_READ,
  tag: NEVER_READ,
  createTime: '1742728163000',
  updateTime: '1742728999000',
  ...overrides,
});

export const transferRow = (overrides: Record<string, unknown> = {}) => ({
  transferId: 'f4a5e7b8-0000-4000-8000-000000000001',
  coin: 'USDT',
  amount: '5000',
  fromAccountType: 'SPOT',
  toAccountType: 'UNIFIED',
  timestamp: '1742728163000',
  status: 'SUCCESS',
  ...overrides,
});

/** A fetch that answers one page of the route's list, with the cursor the page names. */
export const pageAnswer = (field: 'rows' | 'list', list: unknown, nextPageCursor: unknown = '') =>
  answerWith({ body: envelopeOf(0, { [field]: list, nextPageCursor }) });

/** The options every history read of these tests passes: the answer and a fixed clock. */
export const optionsOf = (fetchImpl: typeof fetch) => ({ fetchImpl, now: () => NOW });
