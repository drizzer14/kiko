import { StyleSheet, Text } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, LayoutMode } from '@kiko/display-regions';
import { paneContextOf, usePaneContext } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import TwoPaneLayout from '.';

const mockUseLayoutMode = jest.fn((): LayoutMode => 'columns');
const mockUseFoldRegion = jest.fn((): FoldRegion => null);
jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useFoldRegion: () => mockUseFoldRegion(),
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 951, height: 669, scale: 3, fontScale: 1 }),
}));

const HAIRLINE = darkTheme.layout.hairline;
const HALF = (951 - HAIRLINE) / 2;

const renderLayout = () =>
  render(
    <TwoPaneLayout
      companion={<Text testID="companion-content">companion</Text>}
      primary={<Text testID="primary-content">primary</Text>}
    />,
  );

const frameOf = (testID: string) => {
  const { left, top, width, height } = StyleSheet.flatten(screen.getByTestId(testID).props.style);

  return { x: left, y: top, width, height };
};

describe('TwoPaneLayout', () => {
  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseFoldRegion.mockReturnValue(null);
  });

  it('renders only the primary content in single mode', async () => {
    mockUseLayoutMode.mockReturnValue('single');
    await renderLayout();

    expect(screen.getByTestId('primary-content')).toBeTruthy();
    expect(screen.queryByTestId('companion-content')).toBeNull();
    expect(screen.queryByTestId('two-pane-companion')).toBeNull();
    expect(screen.queryByTestId('two-pane-divider')).toBeNull();
  });

  it('renders the companion before the primary, in the resolved columns frames', async () => {
    await renderLayout();

    expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: HALF, height: 669 });
    expect(frameOf('two-pane-primary')).toEqual({
      x: HALF + HAIRLINE,
      y: 0,
      width: HALF,
      height: 669,
    });

    const root = screen.toJSON();
    const order =
      root !== null && !Array.isArray(root)
        ? (root.children ?? []).map((child) =>
            typeof child === 'string' ? child : child.props.testID,
          )
        : [];
    expect(order).toEqual(['two-pane-companion', 'two-pane-divider', 'two-pane-primary']);
  });

  it('stacks the companion above the primary in rows mode', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    await renderLayout();

    const half = (669 - HAIRLINE) / 2;

    expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: 951, height: half });
    expect(frameOf('two-pane-primary')).toEqual({
      x: 0,
      y: half + HAIRLINE,
      width: 951,
      height: half,
    });
  });

  it('lays out the mode it is pinned to, whatever the window reports', async () => {
    mockUseLayoutMode.mockReturnValue('single');
    await render(
      <TwoPaneLayout
        mode="rows"
        companion={<Text testID="companion-content">companion</Text>}
        primary={<Text testID="primary-content">primary</Text>}
      />,
    );

    const half = (669 - HAIRLINE) / 2;

    expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: 951, height: half });
    expect(frameOf('two-pane-primary').y).toBe(half + HAIRLINE);
  });

  it('shows the hairline divider only when flat', async () => {
    await renderLayout();

    expect(frameOf('two-pane-divider')).toEqual({ x: HALF, y: 0, width: HAIRLINE, height: 669 });
  });

  it('drops the divider and ends the panes at the fold when folded', async () => {
    mockUseFoldRegion.mockReturnValue({ x: 455.5, y: 0, width: 40, height: 669 });
    await renderLayout();

    expect(screen.queryByTestId('two-pane-divider')).toBeNull();
    expect(frameOf('two-pane-companion').width).toBe(455.5);
    expect(frameOf('two-pane-primary').x).toBe(495.5);
  });

  // Native bars span the whole pane: the content cap and the safe-area edges belong to the screen
  // content, not to this component.
  it.each(['columns', 'rows'] as const)(
    'gives each %s pane child its whole frame, with no cap and no padding',
    async (mode) => {
      mockUseLayoutMode.mockReturnValue(mode);
      await renderLayout();

      for (const [paneId, contentId] of [
        ['two-pane-companion', 'companion-content'],
        ['two-pane-primary', 'primary-content'],
      ]) {
        const pane = screen.getByTestId(paneId);
        const { left, top, width, height, ...rest } = StyleSheet.flatten(pane.props.style);

        expect(rest).toEqual({ position: 'absolute' });
        expect(pane.children).toEqual([screen.getByTestId(contentId)]);
      }
    },
  );

  // The screen content in a pane sizes itself by the pane it is in; the layout only says which.
  describe('the pane each child is rendered in', () => {
    const PaneProbe = ({ name }: { name: string }) => (
      <Text testID={`probe-${name}`}>{JSON.stringify(usePaneContext())}</Text>
    );

    it.each(['columns', 'rows'] as const)('is the %s companion and primary pane', async (mode) => {
      mockUseLayoutMode.mockReturnValue(mode);
      await render(
        <TwoPaneLayout
          companion={<PaneProbe name="companion" />}
          primary={<PaneProbe name="primary" />}
        />,
      );

      expect(screen.getByTestId('probe-companion').children).toEqual([
        JSON.stringify(paneContextOf(mode, 'companion')),
      ]);
      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf(mode, 'primary')),
      ]);
    });

    it('is the pinned mode, not the window one', async () => {
      mockUseLayoutMode.mockReturnValue('columns');
      await render(
        <TwoPaneLayout
          mode="rows"
          companion={<PaneProbe name="companion" />}
          primary={<PaneProbe name="primary" />}
        />,
      );

      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf('rows', 'primary')),
      ]);
    });

    it('is no pane at all in single mode, where the window is the screen', async () => {
      mockUseLayoutMode.mockReturnValue('single');
      await render(
        <TwoPaneLayout
          companion={<PaneProbe name="companion" />}
          primary={<PaneProbe name="primary" />}
        />,
      );

      expect(screen.getByTestId('probe-primary').children).toEqual(['null']);
    });
  });
});
