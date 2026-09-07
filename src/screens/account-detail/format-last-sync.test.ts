import '../../i18n';
import { formatDateTime } from '../../dates/format';
import { i18n } from '../../i18n';

import { formatLastSyncAt, latestSyncedAt } from './format-last-sync';

describe('formatLastSyncAt', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('resolves the never label from the catalogue', () => {
    expect(formatLastSyncAt(null, i18n.t)).toBe(i18n.t('accountDetail.never'));
  });

  it('resolves the never label in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    expect(formatLastSyncAt(null, i18n.t)).toBe('Ніколи');

    await i18n.changeLanguage('en');
  });

  it('still formats a real timestamp', () => {
    expect(formatLastSyncAt(1_700_000_000_000, i18n.t)).toBe(formatDateTime(1_700_000_000_000));
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
