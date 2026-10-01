import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { holdingsRepo } from '@kiko/holdings/repo';
import { dayKeyOf } from '@kiko/prices/price-book';
import { fieldSuffix } from '@kiko/test-support/field-suffix';
import { SaleExceedsHoldingError } from '@kiko/holdings/lots';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import LotFormScreen from './lot-form.screen';

type LotFormProps = ComponentProps<typeof LotFormScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    changeLots: jest.fn(),
  },
}));

const mockRefreshAfterHoldingWrite = jest.fn();
jest.mock('@kiko/sync/refresh-after-holding-write', () => ({
  refreshAfterHoldingWrite: (...args: unknown[]) => mockRefreshAfterHoldingWrite(...args),
}));

const changeLotsMock = holdingsRepo.changeLots as jest.Mock;

const navigation = navigationSpy();

const metalHolding = {
  id: 'h-1',
  type: 'metal',
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

const shareHolding = {
  id: 'h-1',
  type: 'share',
  currency: 'USD',
  metadata: {
    quoteSource: 'eodhd',
    symbol: 'AAPL.US',
    lots: [{ day: dayKeyOf(Date.UTC(2025, 0, 1)), quantityDelta: '3', costMinorUnits: 900_00 }],
  },
};

const seed = (holding: unknown = metalHolding): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = (params: { holdingId: string; lotIndex?: number } = { holdingId: 'h-1' }) =>
  render(
    <LotFormScreen
      navigation={asNavigationProp<LotFormProps['navigation']>(navigation)}
      route={asRouteProp<LotFormProps['route']>('LotForm', params)}
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

const SELL_EXCEEDS = "You can't sell more than you currently hold.";

describe('LotFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    changeLotsMock.mockResolvedValue(undefined);
    mockRefreshAfterHoldingWrite.mockResolvedValue(undefined);
    seed();
  });

  it('defaults to Buy, showing the quantity and total cost fields', async () => {
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Quantity')).toBeTruthy();
    expect(getByLabelText('Total cost')).toBeTruthy();
  });

  it("shows the metal's own unit after the quantity", async () => {
    seed({ ...metalHolding, metadata: { ...metalHolding.metadata, unit: 'oz' } });

    const { getByLabelText } = await renderScreen();

    expect(fieldSuffix(getByLabelText('Quantity'))).toBe('oz');
  });

  it('shows no unit after the quantity for a holding that is not a metal', async () => {
    seed(shareHolding);

    const { getByLabelText } = await renderScreen();

    expect(fieldSuffix(getByLabelText('Quantity'))).toBeNull();
  });

  it('hides the total cost field once Sell is selected', async () => {
    const { getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Sell'));

    expect(queryByLabelText('Total cost')).toBeNull();
  });

  it('adds a buy lot and navigates back', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '5');
    await fireEvent.changeText(utils.getByLabelText('Total cost'), '250000');
    await pickDate(utils, 2025, 2, 10);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(changeLotsMock).toHaveBeenCalledWith('h-1', {
      kind: 'add',
      lot: {
        day: dayKeyOf(new Date(2025, 1, 10).getTime()),
        quantityDelta: '5',
        costMinorUnits: 250_000_00,
      },
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // A stock split adds shares at no cost; the raw EODHD close drops on the
  // same day.
  it('adds a buy lot with a total cost of 0', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '30');
    await fireEvent.changeText(utils.getByLabelText('Total cost'), '0');
    await fireEvent.press(utils.getByText('Save lot'));

    expect(changeLotsMock).toHaveBeenCalledWith('h-1', {
      kind: 'add',
      lot: { day: dayKeyOf(today()), quantityDelta: '30', costMinorUnits: 0 },
    });
  });

  it('blocks a buy save and shows an error for an empty total cost', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '5');
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText('Enter a total cost of 0 or more.')).toBeTruthy();
    expect(changeLotsMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('blocks save and shows an error for an empty quantity', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(changeLotsMock).not.toHaveBeenCalled();
  });

  // The repo works out the sell's cost from the lots stored before it.
  it('adds a sell lot with a negative quantity', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '4');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(changeLotsMock).toHaveBeenCalledWith('h-1', {
      kind: 'add',
      lot: {
        day: dayKeyOf(new Date(2025, 5, 1).getTime()),
        quantityDelta: '-4',
        costMinorUnits: 0,
      },
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('rejects a sell larger than the held quantity, writing nothing', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '11');
    await pickDate(utils, 2025, 5, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText(SELL_EXCEEDS)).toBeTruthy();
    expect(changeLotsMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // 10 held in February, but the March sell of 5 must still be covered, so
  // a backdated February sell of 8 would leave -3 in March.
  it('rejects a backdated sell that a later recorded sell would overdraw', async () => {
    seed({
      ...metalHolding,
      metadata: {
        ...metalHolding.metadata,
        lots: [
          ...metalHolding.metadata.lots,
          { day: dayKeyOf(Date.UTC(2025, 2, 1)), quantityDelta: '-5', costMinorUnits: -250_000_00 },
        ],
      },
    });
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '8');
    await pickDate(utils, 2025, 2, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText(SELL_EXCEEDS)).toBeTruthy();
    expect(changeLotsMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('rejects selling more shares than are held', async () => {
    seed(shareHolding);
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Sell'));
    await fireEvent.changeText(utils.getByLabelText('Quantity'), '3.5');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save lot'));

    expect(utils.getByText(SELL_EXCEEDS)).toBeTruthy();
    expect(changeLotsMock).not.toHaveBeenCalled();
  });

  it('defaults the buy lot day to today when no date is picked', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Quantity'), '1');
    await fireEvent.changeText(utils.getByLabelText('Total cost'), '100');
    await fireEvent.press(utils.getByText('Save lot'));

    expect(changeLotsMock).toHaveBeenCalledWith(
      'h-1',
      expect.objectContaining({ lot: expect.objectContaining({ day: dayKeyOf(today()) }) }),
    );
  });

  describe('the price refresh after a save', () => {
    const saveBuy = async (): Promise<void> => {
      const utils = await renderScreen();

      await fireEvent.changeText(utils.getByLabelText('Quantity'), '1');
      await fireEvent.changeText(utils.getByLabelText('Total cost'), '100');
      await fireEvent.press(utils.getByText('Save lot'));
    };

    // A lot dated before the stored prices needs their history.
    it("asks for a share's prices", async () => {
      seed(shareHolding);

      await saveBuy();

      await waitFor(() => expect(mockRefreshAfterHoldingWrite).toHaveBeenCalledWith(true));
    });

    it("asks for a metal's prices and no share prices", async () => {
      await saveBuy();

      await waitFor(() => expect(mockRefreshAfterHoldingWrite).toHaveBeenCalledWith(false));
    });

    it('asks for nothing when the write fails, and keeps the form open', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      changeLotsMock.mockRejectedValue(new SaleExceedsHoldingError());

      await saveBuy();

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(mockRefreshAfterHoldingWrite).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('editing a stored lot', () => {
    const withSale = {
      ...metalHolding,
      metadata: {
        ...metalHolding.metadata,
        lots: [
          ...metalHolding.metadata.lots,
          { day: dayKeyOf(Date.UTC(2025, 2, 1)), quantityDelta: '-4', costMinorUnits: -200_000_00 },
        ],
      },
    };

    it('titles the screen Edit Lot', async () => {
      await renderScreen({ holdingId: 'h-1', lotIndex: 0 });

      expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Lot' });
    });

    it('seeds a buy from the stored lot and saves the change in its place', async () => {
      seed(withSale);
      const utils = await renderScreen({ holdingId: 'h-1', lotIndex: 0 });

      expect(utils.getByLabelText('Quantity').props.value).toBe('10');
      expect(utils.getByLabelText('Total cost').props.value).toBe('500 000');

      await fireEvent.changeText(utils.getByLabelText('Total cost'), '600000');
      await fireEvent.press(utils.getByText('Save lot'));

      expect(changeLotsMock).toHaveBeenCalledWith('h-1', {
        kind: 'edit',
        index: 0,
        lot: {
          day: dayKeyOf(Date.UTC(2025, 0, 1)),
          quantityDelta: '10',
          costMinorUnits: 600_000_00,
        },
      });
      expect(navigation.goBack).toHaveBeenCalled();
    });

    it('seeds a sell from the stored lot, with no total cost field', async () => {
      seed(withSale);
      const utils = await renderScreen({ holdingId: 'h-1', lotIndex: 1 });

      expect(utils.getByLabelText('Quantity').props.value).toBe('4');
      expect(utils.queryByLabelText('Total cost')).toBeNull();

      await fireEvent.press(utils.getByText('Save lot'));

      expect(changeLotsMock).toHaveBeenCalledWith('h-1', {
        kind: 'edit',
        index: 1,
        lot: { day: dayKeyOf(Date.UTC(2025, 2, 1)), quantityDelta: '-4', costMinorUnits: 0 },
      });
    });

    it('blocks a buy cut below what a later sale needs', async () => {
      seed(withSale);
      const utils = await renderScreen({ holdingId: 'h-1', lotIndex: 0 });

      await fireEvent.changeText(utils.getByLabelText('Quantity'), '3');
      await fireEvent.press(utils.getByText('Save lot'));

      expect(
        utils.getByText('A later sale needs this quantity. Change or delete that sale first.'),
      ).toBeTruthy();
      expect(changeLotsMock).not.toHaveBeenCalled();
    });

    it('lets an edited sell take back its own quantity', async () => {
      seed(withSale);
      const utils = await renderScreen({ holdingId: 'h-1', lotIndex: 1 });

      await fireEvent.changeText(utils.getByLabelText('Quantity'), '10');
      await fireEvent.press(utils.getByText('Save lot'));

      expect(changeLotsMock).toHaveBeenCalledWith(
        'h-1',
        expect.objectContaining({ kind: 'edit', index: 1 }),
      );
    });
  });
});
