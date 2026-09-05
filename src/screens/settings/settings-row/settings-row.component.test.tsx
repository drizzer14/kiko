import { fireEvent, render } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import '../../../design-system/unistyles';
import GlassSurface from '../../../design-system/components/glass-surface';

import SettingsRow from './settings-row.component';

describe('SettingsRow', () => {
  it('renders its label', async () => {
    const { getByText } = await render(<SettingsRow label="Base currency" />);
    expect(getByText('Base currency')).toBeTruthy();
  });

  it('renders a trailing chevron only when the row navigates (onPress given)', async () => {
    const { queryByTestId } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    // The chevron is hidden from the a11y tree, so it is only reachable with
    // `includeHiddenElements`.
    expect(queryByTestId('settings-row-chevron', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders no trailing chevron for a non-navigating row', async () => {
    const { queryByTestId } = await render(<SettingsRow label="Base currency" />);
    expect(queryByTestId('settings-row-chevron', { includeHiddenElements: true })).toBeNull();
  });

  it('hides the decorative chevron from the accessibility tree', async () => {
    const { getByTestId } = await render(<SettingsRow label="Categories" onPress={jest.fn()} />);
    const chevron = getByTestId('settings-row-chevron', { includeHiddenElements: true });
    expect(chevron.props.accessibilityElementsHidden).toBe(true);
  });

  it('calls onPress when a navigating row is pressed', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<SettingsRow label="Categories" onPress={onPress} />);
    await fireEvent.press(getByText('Categories'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not itself a pressable when it has no onPress, so it never swallows a child press', async () => {
    const { queryByRole } = await render(
      <SettingsRow label="Base currency">
        <RNText>child content</RNText>
      </SettingsRow>,
    );
    expect(queryByRole('button')).toBeNull();
  });

  // Two rows must stay two INDEPENDENT pressables, never one shared box with
  // two actions baked into a single tap target (the old boxed side-by-side
  // button block). Each setting now sits in its own card, but a row must never
  // swallow a sibling row's press regardless of how they are grouped.
  it('renders as independently pressable rows, never one shared box', async () => {
    const onPressFirst = jest.fn();
    const onPressSecond = jest.fn();
    const { getByText, getAllByRole } = await render(
      <GlassSurface>
        <SettingsRow label="First" onPress={onPressFirst} />
        <SettingsRow label="Second" onPress={onPressSecond} />
      </GlassSurface>,
    );

    expect(getAllByRole('button')).toHaveLength(2);

    await fireEvent.press(getByText('First'));
    expect(onPressFirst).toHaveBeenCalledTimes(1);
    expect(onPressSecond).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Second'));
    expect(onPressSecond).toHaveBeenCalledTimes(1);
    expect(onPressFirst).toHaveBeenCalledTimes(1);
  });
});
