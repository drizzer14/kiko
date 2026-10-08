import { StyleSheet, Text } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, LayoutMode } from '@kiko/display-regions';

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

// The native SafeAreaView takes an edge-mode map, which the package mock passes through as given.
const reservedEdges = (testID: string) =>
  Object.entries(screen.getByTestId(testID).props.edges)
    .filter(([, mode]) => mode === 'additive')
    .map(([edge]) => edge)
    .sort();

const renderLayout = async () =>
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

  it('caps and centres each pane content at the layout token', async () => {
    await renderLayout();

    for (const testID of ['two-pane-companion-content', 'two-pane-primary-content']) {
      const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);

      expect(style.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
      expect(style.alignSelf).toBe('center');
      expect(style.width).toBe('100%');
    }
  });

  it('reserves the columns outer sides only', async () => {
    await renderLayout();

    expect(reservedEdges('two-pane-companion-safe-area')).toEqual(['bottom', 'left', 'top']);
    expect(reservedEdges('two-pane-primary-safe-area')).toEqual(['bottom', 'right', 'top']);
  });

  it('reserves the rows outer sides: companion keeps the top, primary the bottom', async () => {
    mockUseLayoutMode.mockReturnValue('rows');
    await renderLayout();

    expect(reservedEdges('two-pane-companion-safe-area')).toEqual(['left', 'right', 'top']);
    expect(reservedEdges('two-pane-primary-safe-area')).toEqual(['bottom', 'left', 'right']);
  });
});
