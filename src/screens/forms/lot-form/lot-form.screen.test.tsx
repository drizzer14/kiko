import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';
import { holdingsRepo } from '@kiko/holdings/repo';

import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';
import { dayKeyOf } from '../../../prices/price-book';

import LotFormScreen from './lot-form.screen';

type LotFormProps = ComponentProps<typeof LotFormScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    update: jest.fn(),
  },
}));

const navigation = navigationSpy();
const route = asRouteProp<LotFormProps['route']>('LotForm', { holdingId: 'h-1' });

const metalHolding = {
  id: 'h-1',
  currency: 'UAH',
  metadata: {
    metal: 'XAU',
    form: 'bar',
    unit: 'g',
    purity: '0.999',
    lots: [
      { day: dayKeyOf(Date.UTC(2025, 0, 1)), quantityDelta: '10', costMinorUnits: 500_000_00 },
    ],
  },
};

const seed = (holding: unknown = metalHolding): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = () =>
  render(
    <LotFormScreen
      navigation={asNavigationProp<LotFormProps['navigation']>(navigation)}
      route={route}
    />,
  );

const today = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const pickDate = async (
  utils: Awaited<ReturnType<typeof render>>,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Date'));
  await fireEvent(utils.getByTestId('Date calendar'), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
};

describe('LotFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  it('defaults to Buy, showing the quantity and total cost fields', async () => {
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Quantity')).toBeTruthy();
    expect(getByLabelText('Total cost')).toBeTruthy();
  });

  it('hides the total cost field once Sell is selected', async () => {
    const { getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Sell'));

    expect(queryByLabelText('Total cost')).toBeNull();
  });

  it('appends a positive buy lot and navigates back', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '5');
    await fireEvent.changeText(utils.getByLabelText('Total cost'), '250000');
    await pickDate(utils, 2025, 2, 10);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(holdingsRepo.update).toHaveBeenCalledWith('h-1', {
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'g',
        purity: '0.999',
        lots: [
          ...metalHolding.metadata.lots,
          {
            day: dayKeyOf(new Date(2025, 1, 10).getTime()),
            quantityDelta: '5',
            costMinorUnits: 250_000_00,
          },
        ],
      },
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('blocks a buy save and shows an error for a 0 total cost', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '5');
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText('Total cost must be greater than 0.')).toBeTruthy();
    expect(holdingsRepo.update).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('blocks save and shows an error for an empty quantity', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(holdingsRepo.update).not.toHaveBeenCalled();
  });

  it('appends a negative sell lot, cost basis removed proportionally, on a valid sell', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '4');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    // Held quantity at the sell day is 10 (the one seeded buy lot); cost basis
    // at that day is 500,000.00 UAH (500_000_00 minor units). Selling 4 of 10
    // removes 4/10 of the cost basis: 200_000_00, stored NEGATIVE alongside
    // the negative quantityDelta.
    expect(holdingsRepo.update).toHaveBeenCalledWith('h-1', {
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'g',
        purity: '0.999',
        lots: [
          ...metalHolding.metadata.lots,
          {
            day: dayKeyOf(new Date(2025, 5, 1).getTime()),
            quantityDelta: '-4',
            costMinorUnits: -200_000_00,
          },
        ],
      },
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // The lot form rejects a sell delta larger than
  // `quantityAt(sellDay)` — no metadata write, no navigation, and (since this
  // screen never imports transactionsRepo at all) structurally no
  // Transaction row either.
  it('rejects a sell larger than the held quantity, writing nothing', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '11');
    await pickDate(utils, 2025, 5, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText("You can't sell more than you currently hold.")).toBeTruthy();
    expect(holdingsRepo.update).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('defaults the buy lot day to today when no date is picked', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '1');
    await fireEvent.changeText(utils.getByLabelText('Total cost'), '100');
    await fireEvent.press(utils.getByText('Save lot'));

    expect(holdingsRepo.update).toHaveBeenCalledWith(
      'h-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          lots: expect.arrayContaining([expect.objectContaining({ day: dayKeyOf(today()) })]),
        }),
      }),
    );
  });
});
