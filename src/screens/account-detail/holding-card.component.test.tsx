import { ActionSheetIOS, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { HoldingRow } from '../../db/schema';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import HoldingCard from './holding-card.component';

// A minimal, valuable manual holding. holdingValue takes the default `flat`
// branch for a `card` type, so its value is just the stored balance.
const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Black card',
    type: 'card',
    currency: 'UAH',
    balanceMinorUnits: 100000,
    icon: null,
    metadata: null,
    ...overrides,
  }) as unknown as HoldingRow;

const NOW = Date.UTC(2024, 0, 1);

describe('HoldingCard', () => {
  it('renders the holding name and its computed value', async () => {
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );
    expect(getByText('Black card')).toBeTruthy();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('opens the holding detail on a plain tap', async () => {
    const onOpen = jest.fn();
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={onOpen} />,
    );
    await fireEvent.press(getByText('Black card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens an iOS action sheet offering Delete (destructive) and Cancel on long-press', async () => {
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} onDelete={jest.fn()} />,
    );

    await fireEvent(getByText('Black card'), 'longPress');

    expect(spy).toHaveBeenCalledWith(
      { options: ['Delete', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      expect.any(Function),
    );
    spy.mockRestore();
  });

  it('runs the delete handler when Delete (index 0) is chosen from the menu', async () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => {
        callback(0);
      });
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} onDelete={onDelete} />,
    );

    await fireEvent(getByText('Black card'), 'longPress');

    expect(onDelete).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not delete when Cancel (index 1) is chosen from the menu', async () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => {
        callback(1);
      });
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} onDelete={onDelete} />,
    );

    await fireEvent(getByText('Black card'), 'longPress');

    expect(onDelete).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('offers no menu on long-press when the card is not deletable (no onDelete)', async () => {
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );

    await fireEvent(getByText('Black card'), 'longPress');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders the value larger (heading step) and bold, above a wider gap from the name', async () => {
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );
    const valueStyle = StyleSheet.flatten(getByText(/1,000\.00 ₴/).props.style);
    // One typography step above body: the heading font size, at the title weight.
    expect(valueStyle.fontSize).toBe(darkTheme.typography.heading.fontSize);
    expect(valueStyle.fontWeight).toBe(darkTheme.typography.title.fontWeight);
  });
});
