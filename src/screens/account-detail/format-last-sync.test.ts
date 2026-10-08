import { i18n } from '@kiko/i18n/init';
import { formatDateTime, type TimeClock } from '@kiko/dates';

import { formatLastSyncAt, latestSyncedAt } from './format-last-sync';

const TWENTY_FOUR_HOUR: TimeClock = { uses24Hour: true };
const TWELVE_HOUR: TimeClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };

describe('formatLastSyncAt', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('resolves the never label from the catalogue', () => {
    expect(formatLastSyncAt(null, i18n.t, TWENTY_FOUR_HOUR)).toBe(i18n.t('accountDetail.never'));
  });

  it('resolves the never label in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    expect(formatLastSyncAt(null, i18n.t, TWENTY_FOUR_HOUR)).toBe('Ніколи');

    await i18n.changeLanguage('en');
  });

  it.each([TWENTY_FOUR_HOUR, TWELVE_HOUR])('still formats a real timestamp on %p', (clock) => {
    expect(formatLastSyncAt(1_700_000_000_000, i18n.t, clock)).toBe(
      formatDateTime(1_700_000_000_000, clock),
    );
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
