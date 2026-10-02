import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import OversizedSaleNotice from './oversized-sale-notice.component';
import type { OversizedSaleNoticeProps } from './oversized-sale-notice.props';

type Holding = NonNullable<OversizedSaleNoticeProps['holding']>;

const buy = { day: Date.UTC(2026, 0, 10), quantityDelta: '3', costMinorUnits: 90_000 };
const sale = { day: Date.UTC(2026, 2, 10), quantityDelta: '-2', costMinorUnits: -60_000 };
const oversizedSale = { ...sale, quantityDelta: '-5' };

const holdingOf = (type: Holding['type'], lots: unknown): Holding => ({
  type,
  metadata: { quoteSource: 'manual', metal: 'XAU', lots },
});

const NOTICE = 'A sale here is larger than what was held before it. Edit or delete that sale.';

describe('OversizedSaleNotice', () => {
  it.each(['share', 'metal'] as const)(
    'asks to fix a %s sale larger than what was held before it',
    async (type) => {
      const { getByTestId } = await render(
        <OversizedSaleNotice holding={holdingOf(type, [buy, oversizedSale])} />,
      );

      expect(getByTestId('oversized-sale-notice')).toHaveTextContent(NOTICE);
    },
  );

  it('reads a buy recorded later with an earlier day as held before the sale', async () => {
    const { queryByTestId } = await render(
      <OversizedSaleNotice
        holding={holdingOf('share', [oversizedSale, { ...buy, quantityDelta: '5' }])}
      />,
    );

    expect(queryByTestId('oversized-sale-notice')).toBeNull();
  });

  it.each([
    ['every sale covered', holdingOf('share', [buy, sale])],
    ['unreadable lots', holdingOf('share', [buy, { day: 'x' }])],
    ['no lots', holdingOf('metal', undefined)],
    ['a type whose lots have no rows to fix', holdingOf('property_item', [buy, oversizedSale])],
  ])('shows nothing for %s', async (_state, holding) => {
    const { queryByTestId } = await render(<OversizedSaleNotice holding={holding} />);

    expect(queryByTestId('oversized-sale-notice')).toBeNull();
  });

  it('shows nothing before the holding loads', async () => {
    const { queryByTestId } = await render(<OversizedSaleNotice holding={undefined} />);

    expect(queryByTestId('oversized-sale-notice')).toBeNull();
  });

  it('reads in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    try {
      const { getByTestId } = await render(
        <OversizedSaleNotice holding={holdingOf('share', [buy, oversizedSale])} />,
      );

      expect(getByTestId('oversized-sale-notice')).toHaveTextContent(
        'Продаж тут більший, ніж було в наявності до нього. Відредагуйте або видаліть цей продаж.',
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
