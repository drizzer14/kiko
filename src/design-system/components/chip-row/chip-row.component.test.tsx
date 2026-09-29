import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import ChipRow from '.';

// Text's tone -> color mapping is a unistyles variant the Jest mock strips, so
// the label's tone is read from the shared mock's testID instead.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-tone').default,
}));

const options = ['bank', 'cash', 'crypto'] as const;

describe('ChipRow', () => {
  it('reports the pressed option through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={onSelect} />,
    );

    await fireEvent.press(getByText('cash'));

    expect(onSelect).toHaveBeenCalledWith('cash');
  });

  it('humanizes chip text through the labels map while still reporting the raw value', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <ChipRow
        options={options}
        selected="bank"
        onSelect={onSelect}
        labels={{ crypto: 'Crypto Wallet' }}
      />,
    );

    await fireEvent.press(getByText('Crypto Wallet'));

    expect(onSelect).toHaveBeenCalledWith('crypto');
  });

  it('marks the selected chip via accessibilityState', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="cash" onSelect={jest.fn()} />,
    );

    expect(getByText('cash').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('bank').parent?.props.accessibilityState.selected).toBe(false);
  });

  // The native iOS filter-chip look: the selected chip is the accent fill with
  // the always-white onAccent label, an unselected chip a faint neutral fill
  // with the primary label — never a solid dark surface.
  it('fills the selected chip with the accent and an unselected chip with the faint neutral fill', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="cash" onSelect={jest.fn()} />,
    );

    const selectedChip = StyleSheet.flatten(getByText('cash').parent?.props.style);
    const unselectedChip = StyleSheet.flatten(getByText('bank').parent?.props.style);
    expect(selectedChip.backgroundColor).toBe(darkTheme.colors.accent);
    expect(unselectedChip.backgroundColor).toBe(darkTheme.colors.neutralSubtle);
    expect(getByText('cash').props.testID).toBe('text-tone-onAccent');
    expect(getByText('bank').props.testID).toBe('text-tone-textPrimary');
  });
});

describe('ChipRow multi-select mode', () => {
  it('marks every value in selectedValues as selected and the rest as unselected', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selectedValues={['bank', 'crypto']} onToggle={jest.fn()} />,
    );

    expect(getByText('bank').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('crypto').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('cash').parent?.props.accessibilityState.selected).toBe(false);
  });

  it('reports a tap on a selected or an unselected chip through onToggle', async () => {
    const onToggle = jest.fn();
    const { getByText } = await render(
      <ChipRow options={options} selectedValues={['bank']} onToggle={onToggle} />,
    );

    await fireEvent.press(getByText('bank'));
    await fireEvent.press(getByText('cash'));

    expect(onToggle.mock.calls).toEqual([['bank'], ['cash']]);
  });

  it('keeps the single-select chip look for each selected and unselected chip', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selectedValues={['bank', 'crypto']} onToggle={jest.fn()} />,
    );

    const selectedChip = StyleSheet.flatten(getByText('crypto').parent?.props.style);
    const unselectedChip = StyleSheet.flatten(getByText('cash').parent?.props.style);
    expect(selectedChip.backgroundColor).toBe(darkTheme.colors.accent);
    expect(unselectedChip.backgroundColor).toBe(darkTheme.colors.neutralSubtle);
    expect(selectedChip.minHeight).toBe(34);
    expect(getByText('crypto').parent?.props.hitSlop).toEqual({ top: 5, bottom: 5 });
    expect(getByText('crypto').props.testID).toBe('text-tone-onAccent');
    expect(getByText('cash').props.testID).toBe('text-tone-textPrimary');
  });

  it('renders no chip selected for an empty selectedValues list', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selectedValues={[]} onToggle={jest.fn()} />,
    );

    for (const option of options) {
      expect(getByText(option).parent?.props.accessibilityState.selected).toBe(false);
    }
  });
});
