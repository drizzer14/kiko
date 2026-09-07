import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { RenderedElement } from '../../../test-support/rendered-element';
import { DISABLED_OPACITY } from '../../disabled-opacity';
import '../../unistyles';
import IconButton from './icon-button.component';

// The glyph is a native SFSymbolView; mock it to a plain text node exposing the
// props IconButton controls (name/color/size), so a test can assert what the
// primitive forwards without the native module.
jest.mock('../symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name, color, size }: { name: string; color?: string; size?: number }) => (
      <RNText>{`icon:${name}|${String(color)}|${String(size)}`}</RNText>
    ),
  };
});

const flattenRoot = (node: RenderedElement): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('IconButton', () => {
  it('renders the given SF Symbol glyph', async () => {
    const { getByText } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} />,
    );

    expect(getByText(/icon:arrow\.counterclockwise/)).toBeTruthy();
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={onPress} />,
    );

    await fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress and dims to the shared disabled opacity when disabled', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={onPress} disabled />,
    );

    const button = getByRole('button');
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(flattenRoot(button).opacity).toBe(DISABLED_OPACITY);
  });

  it('does not dim when enabled', async () => {
    const { getByRole } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} />,
    );

    expect(flattenRoot(getByRole('button')).opacity).toBeUndefined();
  });

  it('forwards an accessibilityLabel so an icon-only control is announced', async () => {
    const { getByLabelText } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} accessibilityLabel="Reset" />,
    );

    expect(getByLabelText('Reset')).toBeTruthy();
  });

  it('forwards a testID onto the pressable so a caller can target it', async () => {
    const { getByTestId } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} testID="my-icon-button" />,
    );

    expect(getByTestId('my-icon-button')).toBeTruthy();
  });

  it('tints the glyph with the given theme tint and sizes it', async () => {
    const { getByText } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} tint="#FFD60A" size={24} />,
    );

    expect(getByText('icon:arrow.counterclockwise|#FFD60A|24')).toBeTruthy();
  });

  it('leaves the tint unset (glyph uses its own tone default) and defaults the size', async () => {
    const { getByText } = await render(
      <IconButton symbol="arrow.counterclockwise" onPress={() => {}} />,
    );

    // No explicit color reaches the glyph, so SymbolIcon falls back to its own
    // textSecondary tone; the size defaults to the Button icon size (18).
    expect(getByText('icon:arrow.counterclockwise|undefined|18')).toBeTruthy();
  });
});
