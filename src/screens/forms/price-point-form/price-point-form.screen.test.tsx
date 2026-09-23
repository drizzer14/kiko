import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../../design-system/unistyles';
import '../../../i18n';

import { dayKeyOf } from '../../../prices/price-book';
import { pricePointsRepo } from '../../../prices/price-points-repo';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';

import PricePointFormScreen from './price-point-form.screen';

type PricePointFormProps = ComponentProps<typeof PricePointFormScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('../../../prices/price-points-repo', () => ({
  pricePointsRepo: { upsertMany: jest.fn() },
}));

const navigation = navigationSpy();
const route = asRouteProp<PricePointFormProps['route']>('PricePointForm', { holdingId: 'h-1' });

const propertyHolding = { id: 'h-1', currency: 'UAH' };

const seed = (holding: unknown = propertyHolding): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = () =>
  render(
    <PricePointFormScreen
      navigation={asNavigationProp<PricePointFormProps['navigation']>(navigation)}
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

describe('PricePointFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
  });

  it('shows the holding currency glyph as the value suffix', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('₴')).toBeTruthy();
  });

  it('shows the suffix in the holding own currency, not a fixed one', async () => {
    seed({ id: 'h-1', currency: 'USD' });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('$')).toBeTruthy();
    expect(queryByText('₴')).toBeNull();
  });

  it('writes a manual price point on holding:<id> for the picked date and navigates back', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Value'), '5000');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save value'));

    expect(pricePointsRepo.upsertMany).toHaveBeenCalledWith([
      {
        instrument: 'holding:h-1',
        day: dayKeyOf(new Date(2025, 5, 1).getTime()),
        price: '5000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('defaults the date to today', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Value'), '5000');
    await fireEvent.press(utils.getByText('Save value'));

    expect(pricePointsRepo.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ day: dayKeyOf(today()) }),
    ]);
  });

  it('blocks save and shows an error for a value of 0', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Save value'));

    expect(utils.getByText('Value must be greater than 0.')).toBeTruthy();
    expect(pricePointsRepo.upsertMany).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
