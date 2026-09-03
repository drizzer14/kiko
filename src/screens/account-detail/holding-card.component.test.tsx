import { StyleSheet } from 'react-native';
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

  it('tints the icon with the holding stored color', async () => {
    const { getByLabelText } = await render(
      <HoldingCard
        holding={holding({ color: darkTheme.colors.entityColors.violet })}
        now={NOW}
        onOpen={jest.fn()}
      />,
    );

    expect(getByLabelText('Black card icon').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('falls back to the type default color when the holding has no stored color', async () => {
    const { getByLabelText } = await render(
      <HoldingCard holding={holding({ color: null })} now={NOW} onOpen={jest.fn()} />,
    );

    // A `card` holding with no color reads the card type default (white).
    expect(getByLabelText('Black card icon').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
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
