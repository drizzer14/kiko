import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { dayKeyOf } from '@kiko/prices/price-book';
import { pricePointsRepo } from '@kiko/prices/price-points-repo';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';
import { expectNavBarSaveOnly, pressSave } from '@kiko/test-support/form-header-items';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import PricePointFormScreen from './price-point-form.screen';

type PricePointFormProps = ComponentProps<typeof PricePointFormScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/prices/price-points-repo', () => ({
  pricePointsRepo: { upsertMany: jest.fn() },
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

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
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    expect(pricePointsRepo.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ day: dayKeyOf(today()) }),
    ]);
  });

  it('blocks save and shows an error for a value of 0', async () => {
    const utils = await renderScreen();

    await pressSave(navigation.setOptions);

    expect(utils.getByText('Value must be greater than 0.')).toBeTruthy();
    expect(pricePointsRepo.upsertMany).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('scrolls the mounted value field into view with the live scroll geometry on a blocked Save', async () => {
    (useHeaderInset as jest.Mock).mockReturnValue(96);
    const utils = await renderScreen();

    await fireEvent(utils.getByTestId('screen-scroll-view'), 'contentSizeChange', 0, 640);
    await pressSave(navigation.setOptions);

    expect(scrollToField).toHaveBeenCalledTimes(1);
    const [scrollableRef, fieldRef, geometry, onSettled] = (scrollToField as jest.Mock).mock
      .calls[0];
    expect(scrollableRef).toEqual({ current: null });
    expect(fieldRef.current).not.toBeNull();
    expect(geometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(onSettled).toEqual(expect.any(Function));
  });

  it('does not scroll when the value is valid', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Value'), '100');
    await pressSave(navigation.setOptions);

    expect(scrollToField).not.toHaveBeenCalled();
  });

  // A loan's correction targets its own manual outstanding series
  // through this SAME form (PricePointForm never changes for a loan — see
  // holding-detail's own holdingDetailSpecs doc comment), but the stack's
  // static "Update Value" title reads wrong for a debt, so the screen
  // overrides it once the holding loads.
  it('overrides the title to "Update Outstanding" for a loan holding', async () => {
    seed({ id: 'h-1', currency: 'UAH', type: 'loan' });

    await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Update Outstanding' });
  });

  it('does not override the title for a non-loan (property_item) holding', async () => {
    seed({ id: 'h-1', currency: 'UAH', type: 'property_item' });

    await renderScreen();

    // `expect.anything()` would let a `title: undefined` slip through, so check the key itself.
    const optionsWithTitle = navigation.setOptions.mock.calls.filter(([options]) =>
      Object.hasOwn(options, 'title'),
    );

    expect(optionsWithTitle).toEqual([]);
  });

  // A loan can be recorded as fully repaid — its
  // outstanding series must be able to reach exactly 0, unlike every other
  // priced holding type.
  it('saves a loan outstanding of 0, writing 0.00 on its own holding:<id> series', async () => {
    seed({ id: 'h-1', currency: 'UAH', type: 'loan' });
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Outstanding'), '0');
    await pressSave(navigation.setOptions);

    expect(pricePointsRepo.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ instrument: 'holding:h-1', price: '0.00', currency: 'UAH' }),
    ]);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // SQLite does not check the stored type, so it can name an Object.prototype key.
  it.each(['unknown_type', 'toString', 'constructor'])(
    'asks a holding of stored type %p for its value',
    async (type) => {
      seed({ id: 'h-1', currency: 'UAH', type });
      const utils = await renderScreen();

      expect(utils.getByLabelText('Value')).toBeTruthy();
    },
  );

  it('still blocks a non-loan holding at 0, with the generic error', async () => {
    seed({ id: 'h-1', currency: 'UAH', type: 'property_item' });
    const utils = await renderScreen();

    await pressSave(navigation.setOptions);

    expect(utils.getByText('Value must be greater than 0.')).toBeTruthy();
    expect(pricePointsRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('reads a row of a type this build no longer has as a plain value', async () => {
    seed({ id: 'h-1', currency: 'USD', type: 'share' });
    const utils = await renderScreen();

    expect(utils.getByLabelText('Value')).toBeTruthy();
  });

  // A loan's field label and error string read correctly for a debt too, not just the
  // screen title; its Save is the same plain "Save" as every form's.
  it('shows the loan-specific field label and error', async () => {
    seed({ id: 'h-1', currency: 'UAH', type: 'loan' });
    const utils = await renderScreen();

    expect(utils.getByLabelText('Outstanding')).toBeTruthy();

    await fireEvent.changeText(utils.getByLabelText('Outstanding'), '-1');
    await pressSave(navigation.setOptions);

    expect(utils.getByText('Outstanding must be 0 or greater.')).toBeTruthy();
  });

  it('offers Save only as the prominent nav-bar item, never as a body button', async () => {
    expectNavBarSaveOnly(navigation.setOptions, await renderScreen());
  });
});
