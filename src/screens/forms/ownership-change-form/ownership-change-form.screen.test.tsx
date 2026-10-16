import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
  paramsAfter,
} from '@kiko/test-support/navigation-props';
import { holdingsRepo } from '@kiko/holdings/repo';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';
import { expectNavBarSaveOnly, pressSave } from '@kiko/test-support/form-header-items';

import OwnershipChangeFormScreen from './ownership-change-form.screen';

type OwnershipChangeFormProps = ComponentProps<typeof OwnershipChangeFormScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    editOwnershipChange: jest.fn(),
  },
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const firstDay = Date.UTC(2024, 0, 1);
const changeDay = Date.UTC(2025, 5, 1);

const navigation = navigationSpy();

const sharedProperty = (input: string) => ({
  id: 'h-1',
  type: 'property_item',
  currency: 'UAH',
  metadata: {
    category: 'real_estate',
    lots: [{ day: firstDay, quantityDelta: '1', costMinorUnits: 100_000 }],
    ownership: [
      { day: firstDay, numerator: 1, denominator: 2 },
      { day: changeDay, numerator: 1, denominator: 3 },
    ],
    ownershipInput: input,
  },
});

const seed = (holding: unknown): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = (day = changeDay, params: object = { holdingId: 'h-1', day }) =>
  render(
    <OwnershipChangeFormScreen
      navigation={asNavigationProp<OwnershipChangeFormProps['navigation']>(navigation)}
      route={asRouteProp<OwnershipChangeFormProps['route']>('OwnershipChangeForm', params)}
    />,
  );

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const pickEffectiveDate = async (
  screen: Screen,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(screen.getByLabelText('Effective from'));
  await fireEvent(screen.getByTestId('Effective from calendar'), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
};

describe('OwnershipChangeFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed(sharedProperty('fraction'));
  });

  it('pre-fills the share and the effective date of the change it edits', async () => {
    const screen = await renderScreen();

    expect(screen.getByLabelText('Share').props.value).toBe('1');
    expect(screen.getByLabelText('Out of').props.value).toBe('3');
    expect(screen.getByLabelText('Effective from')).toHaveTextContent('01.06.2025');
  });

  it('offers Save only as the prominent nav-bar item, never as a body button', async () => {
    expectNavBarSaveOnly(navigation.setOptions, await renderScreen());
  });

  it('saves an untouched change as it was', async () => {
    seed(sharedProperty('percent'));

    const screen = await renderScreen();

    expect(screen.getByLabelText('Share').props.value).toBe('33.33');

    await pressSave(navigation.setOptions);

    expect(holdingsRepo.editOwnershipChange).toHaveBeenCalledWith(
      'h-1',
      changeDay,
      { day: changeDay, numerator: 1, denominator: 3 },
      'percent',
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('saves a new share and a new effective date for that change only', async () => {
    const screen = await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Out of'), '4');
    await pickEffectiveDate(screen, 2025, 7, 1);
    await pressSave(navigation.setOptions);

    expect(holdingsRepo.editOwnershipChange).toHaveBeenCalledWith(
      'h-1',
      changeDay,
      { day: Date.UTC(2025, 6, 1), numerator: 1, denominator: 4 },
      'fraction',
    );
  });

  it('saves the share in the input form the user switched to', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Percent'));
    await fireEvent.changeText(screen.getByLabelText('Share'), '25');
    await pressSave(navigation.setOptions);

    expect(holdingsRepo.editOwnershipChange).toHaveBeenCalledWith(
      'h-1',
      changeDay,
      { day: changeDay, numerator: 1, denominator: 4 },
      'percent',
    );
  });

  it('blocks Save and shows the share error for a share that does not parse', async () => {
    const screen = await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Share'), '5');
    await pressSave(navigation.setOptions);

    expect(screen.getByText('Enter a share above 0 and up to 100%.')).toBeTruthy();
    expect(holdingsRepo.editOwnershipChange).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('scrolls the mounted share field into view with the live scroll geometry on a blocked Save', async () => {
    (useHeaderInset as jest.Mock).mockReturnValue(96);
    const screen = await renderScreen();

    await fireEvent(screen.getByTestId('screen-scroll-view'), 'contentSizeChange', 0, 640);
    await fireEvent.changeText(screen.getByLabelText('Share'), '5');
    await pressSave(navigation.setOptions);

    expect(scrollToField).toHaveBeenCalledTimes(1);
    const [scrollableRef, fieldRef, geometry, onSettled] = (scrollToField as jest.Mock).mock
      .calls[0];
    expect(scrollableRef).toEqual({ current: null });
    expect(fieldRef.current).not.toBeNull();
    expect(geometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
    expect(onSettled).toEqual(expect.any(Function));
  });

  it('does not scroll when the share is valid', async () => {
    await renderScreen();

    await pressSave(navigation.setOptions);

    expect(scrollToField).not.toHaveBeenCalled();
  });

  describe('the draft', () => {
    const reopen = () =>
      renderScreen(changeDay, paramsAfter(navigation, { holdingId: 'h-1', day: changeDay }));

    it('brings back an edited share and a picked effective date after a remount', async () => {
      const first = await renderScreen();
      await fireEvent.changeText(first.getByLabelText('Out of'), '4');
      await pickEffectiveDate(first, 2025, 7, 1);
      await fireEvent(first.getByLabelText('Out of'), 'blur');
      await first.unmount();

      const second = await reopen();

      expect(second.getByLabelText('Share').props.value).toBe('1');
      expect(second.getByLabelText('Out of').props.value).toBe('4');
      expect(second.getByLabelText('Effective from')).toHaveTextContent('01.07.2025');

      await pressSave(navigation.setOptions);

      expect(holdingsRepo.editOwnershipChange).toHaveBeenCalledWith(
        'h-1',
        changeDay,
        { day: Date.UTC(2025, 6, 1), numerator: 1, denominator: 4 },
        'fraction',
      );
    });

    it('brings back the input form the user switched to', async () => {
      const first = await renderScreen();
      await fireEvent.press(first.getByText('Percent'));
      await fireEvent.changeText(first.getByLabelText('Share'), '25');
      await fireEvent(first.getByLabelText('Share'), 'blur');
      await first.unmount();

      const second = await reopen();

      expect(second.getByLabelText('Share').props.value).toBe('25');
      expect(second.queryByLabelText('Out of')).toBeNull();
    });

    it('keeps the draft to plain values, so the route params stay JSON', async () => {
      const screen = await renderScreen();
      await fireEvent.changeText(screen.getByLabelText('Out of'), '4');
      await fireEvent(screen.getByLabelText('Out of'), 'blur');

      expect(navigation.setParams).toHaveBeenCalledWith({
        draft: {
          entry: { mode: 'fraction', percent: '33.33', numerator: '1', denominator: '4' },
          effectiveDate: expect.any(Number),
        },
      });
    });

    it('writes the draft once per blur, never while typing', async () => {
      const screen = await renderScreen();

      await fireEvent.changeText(screen.getByLabelText('Out of'), '4');
      await fireEvent.changeText(screen.getByLabelText('Out of'), '45');

      expect(navigation.setParams).not.toHaveBeenCalled();

      await fireEvent(screen.getByLabelText('Out of'), 'blur');

      expect(navigation.setParams).toHaveBeenCalledTimes(1);
    });

    it('writes nothing again for a second blur with nothing changed in between', async () => {
      const screen = await renderScreen();

      await fireEvent(screen.getByLabelText('Out of'), 'blur');
      navigation.setParams.mockClear();
      await fireEvent(screen.getByLabelText('Out of'), 'blur');

      expect(navigation.setParams).not.toHaveBeenCalled();
    });

    it('leaves no draft behind once saved: it goes back and writes nothing more', async () => {
      const screen = await renderScreen();
      await fireEvent.changeText(screen.getByLabelText('Out of'), '4');
      await fireEvent(screen.getByLabelText('Out of'), 'blur');
      navigation.setParams.mockClear();

      await pressSave(navigation.setOptions);

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.setParams).not.toHaveBeenCalled();
    });
  });
});
