import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import '../../unistyles';
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
