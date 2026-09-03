import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
// The border width the surface applies comes from Unistyles' own
// `StyleSheet.hairlineWidth`, which is not necessarily react-native's, so the
// assertion reads the expected value from the same source the style uses.
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '../../unistyles';
import { darkTheme } from '../../theme';
// Imported through the folder's index (the real path a screen consumes,
// `design-system/components/glass-surface`), not `./glass-surface.component`
// directly, so this test also exercises index.ts's re-export.
import GlassSurface from '.';

describe('GlassSurface', () => {
  it('renders its children (falls back to a plain View under Jest, since @callstack/liquid-glass is mocked with isLiquidGlassSupported: false)', async () => {
    const { getByText } = await render(
      <GlassSurface padding={3}>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(getByText('content')).toBeTruthy();
  });

  // The tint must land on the very first render: it flows through a
  // Unistyles-managed style member (not a foreign inline backgroundColor
  // appended to the style array, which Unistyles' ShadowNode update drops
  // until a later re-render — the first-paint-transparent card bug).
  it('paints the tint background on first render when a tint is set', async () => {
    const tint = 'rgba(255, 69, 58, 0.1)';
    const { getByTestId } = await render(
      <GlassSurface testID="tinted-surface" tint={tint}>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('tinted-surface').props.style);
    expect(flat.backgroundColor).toBe(tint);
  });

  // The border must land on the very first render for the same reason as the
  // tint: it flows through a Unistyles-managed style member, so its width/color
  // are written to the native ShadowNode on the first frame rather than only
  // after a re-render (the intermittently-bordered card bug, G2).
  it('draws the hairline separator border on first render when bordered', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="bordered-surface" bordered>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('bordered-surface').props.style);
    expect(flat.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(flat.borderColor).toBe(darkTheme.colors.border);
  });

  it('draws no border when not bordered', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="borderless-surface">
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('borderless-surface').props.style);
    expect(flat.borderWidth).toBeUndefined();
  });

  it('leaves the surface background untinted when no tint is set', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="plain-surface">
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('plain-surface').props.style);
    // The fallback surface color, not a tint rgba.
    expect(flat.backgroundColor).not.toMatch(/^rgba\(/);
  });
});
