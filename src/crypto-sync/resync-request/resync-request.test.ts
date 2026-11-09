import { resyncRequest } from './resync-request';

describe('resyncRequest', () => {
  it.each(['btc_wallet', 'binance', 'bybit'] as const)('names %s and carries no address', (id) => {
    expect(resyncRequest(id, 'acc-1')).toEqual({ providerId: id, targetAccountId: 'acc-1' });
  });
});
