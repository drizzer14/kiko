import { BinanceRateLimitError } from './binance.client';

describe('BinanceRateLimitError', () => {
  it('carries its own name and a message naming the status', () => {
    const error = new BinanceRateLimitError(418, 120_000);

    expect(error.name).toBe('BinanceRateLimitError');
    expect(error.message).toBe('Binance rate limit 418');
  });

  it('carries the status and the retry delay it was built with', () => {
    const error = new BinanceRateLimitError(429, 30_000);

    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(30_000);
  });
});
