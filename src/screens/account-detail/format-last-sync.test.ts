import { formatDateTime } from '../../dates/format';

import { formatLastSyncAt, latestSyncedAt } from './format-last-sync';

describe('formatLastSyncAt', () => {
  it('renders Never for a null timestamp', () => {
    expect(formatLastSyncAt(null)).toBe('Never');
  });

  it('renders the shared date-time format otherwise', () => {
    expect(formatLastSyncAt(1_700_000_000_000)).toBe(formatDateTime(1_700_000_000_000));
  });
});

describe('latestSyncedAt', () => {
  it('returns the newest syncedAt across the holdings', () => {
    expect(
      latestSyncedAt([
        { metadata: { walletAddress: 'bc1q', syncedAt: 1_000 } },
        { metadata: { iban: 'UA1' } },
        { metadata: { binanceAsset: 'BTC', syncedAt: 3_000 } },
        { metadata: null },
      ]),
    ).toBe(3_000);
  });

  it('returns null when no holding carries a syncedAt', () => {
    expect(
      latestSyncedAt([{ metadata: { walletAddress: 'bc1q' } }, { metadata: null }]),
    ).toBeNull();
    expect(latestSyncedAt([])).toBeNull();
  });
});
