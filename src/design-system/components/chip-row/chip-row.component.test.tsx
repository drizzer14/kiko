import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import ChipRow from '.';

// Text's tone -> color mapping is a unistyles variant the Jest mock strips, so
// the label's tone is read from the shared mock's testID instead.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('../../../test-support/mock-text-tone').default,
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
