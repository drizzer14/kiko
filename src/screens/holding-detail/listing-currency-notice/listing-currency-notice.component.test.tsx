import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import ListingCurrencyNotice from './listing-currency-notice.component';
import type { ListingCurrencyNoticeProps } from './listing-currency-notice.props';

const lots = [{ day: Date.UTC(2026, 0, 10), quantityDelta: '3', costMinorUnits: 90_000 }];

const share = (
  currency: string,
  metadata: Record<string, unknown>,
): NonNullable<ListingCurrencyNoticeProps['holding']> =>
  ({ type: 'share', currency, metadata: { lots, ...metadata } }) as NonNullable<
    ListingCurrencyNoticeProps['holding']
  >;

const eodhd = { quoteSource: 'eodhd', symbol: 'AAPL.US' };

const NOTICE =
  'EODHD prices this share in USD, so its value does not update. Edit it and set the price source to “Manual” (its cost stays), or delete it and add it again in USD.';

describe('ListingCurrencyNotice', () => {
  it('tells how to fix an EODHD share held in another currency than its listing', async () => {
    const { getByTestId } = await render(
      <ListingCurrencyNotice holding={share('UAH', { ...eodhd, quoteCurrency: 'USD' })} />,
    );

    expect(getByTestId('listing-currency-notice')).toHaveTextContent(NOTICE);
  });

  it('names pounds for a pence listing held in another currency', async () => {
    const { getByText } = await render(
      <ListingCurrencyNotice holding={share('USD', { ...eodhd, quoteCurrency: 'GBX' })} />,
    );

    expect(getByText(/EODHD prices this share in GBP/)).toBeTruthy();
  });

  it.each([
    ['held in its listing currency', share('USD', { ...eodhd, quoteCurrency: 'USD' })],
    ['a pence listing held in pounds', share('GBP', { ...eodhd, quoteCurrency: 'GBX' })],
    ['an EODHD share whose unit is not known yet', share('UAH', eodhd)],
    ['a manual share', share('UAH', { quoteSource: 'manual' })],
    [
      'a holding that is not a share',
      { ...share('UAH', { ...eodhd, quoteCurrency: 'USD' }), type: 'metal' as const },
    ],
    ['a share that does not parse', share('UAH', { ...eodhd, quoteCurrency: 'USD', lots: 'x' })],
  ])('shows nothing for %s', async (_state, holding) => {
    const { queryByTestId } = await render(<ListingCurrencyNotice holding={holding} />);

    expect(queryByTestId('listing-currency-notice')).toBeNull();
  });

  it('shows nothing before the holding loads', async () => {
    const { queryByTestId } = await render(<ListingCurrencyNotice holding={undefined} />);

    expect(queryByTestId('listing-currency-notice')).toBeNull();
  });

  it('reads in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    try {
      const { getByText } = await render(
        <ListingCurrencyNotice holding={share('UAH', { ...eodhd, quoteCurrency: 'USD' })} />,
      );

      expect(getByText(/EODHD подає ціну цієї акції в USD/)).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
