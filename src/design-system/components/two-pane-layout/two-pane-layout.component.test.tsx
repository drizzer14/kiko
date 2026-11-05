import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, LayoutMode } from '@kiko/display-regions';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { paneContextOf, usePaneContext, usePaneWidth } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import TwoPaneLayout from '.';

const mockUseLayoutMode = jest.fn((): LayoutMode => 'columns');
const mockUseFoldRegion = jest.fn((): FoldRegion => null);
const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useFoldRegion: () => mockUseFoldRegion(),
  useVerticalBarEdge: () => 'none',
  useTabBarEdge: () => mockUseTabBarEdge(),
  useDisplayRegions: () => ({ horizontalSizeClass: 'regular' }),
}));

jest.mock('react-native-bottom-tabs', () => ({ useBottomTabBarHeight: () => 0 }));

const mockWindow = { width: 951, height: 669, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
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

// What a child sees of the pane it is rendered in: the pane context and the pane width.
const PaneProbe = ({ name }: { name: string }) => (
  <>
    <Text testID={`probe-${name}`}>{JSON.stringify(usePaneContext())}</Text>
    <Text testID={`width-${name}`}>{String(usePaneWidth())}</Text>
  </>
);

const InsetProbe = ({ name }: { name: string }) => {
  const insets = useSafeAreaInsets();

  return (
    <>
      <Text testID={`inset-${name}`}>{JSON.stringify(insets)}</Text>
      <PaneProbe name={name} />
    </>
  );
};

// Records every mount of a pane child, so a remount shows as a second entry.
const mountLog: string[] = [];
const MountProbe = ({ name }: { name: string }) => {
  useEffect(() => {
    mountLog.push(name);
  }, [name]);

  return <Text>{name}</Text>;
};

const renderProbes = (mode?: 'rows') =>
  render(
    <TwoPaneLayout
      mode={mode}
      companion={<PaneProbe name="companion" />}
      primary={<PaneProbe name="primary" />}
    />,
  );

// Testing Library leaves a pane hidden from accessibility out of its queries by default.
const WITH_HIDDEN = { includeHiddenElements: true } as const;

const frameOf = (testID: string) => {
  const { left, top, width, height } = StyleSheet.flatten(
    screen.getByTestId(testID, WITH_HIDDEN).props.style,
  );

  return { x: left, y: top, width, height };
};

describe('TwoPaneLayout', () => {
  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseFoldRegion.mockReturnValue(null);
    mockUseTabBarEdge.mockReturnValue('none');
    mockWindow.width = 951;
    mockWindow.height = 669;
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
    it.each(['columns', 'rows'] as const)('is the %s companion and primary pane', async (mode) => {
      mockUseLayoutMode.mockReturnValue(mode);
      await renderProbes();

      expect(screen.getByTestId('probe-companion').children).toEqual([
        JSON.stringify(paneContextOf(mode, 'companion')),
      ]);
      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf(mode, 'primary')),
      ]);
    });

    it('is the pinned mode, not the window one', async () => {
      mockUseLayoutMode.mockReturnValue('columns');
      await renderProbes('rows');

      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf('rows', 'primary')),
      ]);
    });

    it('is no pane at all in single mode, where the window is the screen', async () => {
      mockUseLayoutMode.mockReturnValue('single');
      await renderProbes();

      expect(screen.getByTestId('probe-primary').children).toEqual(['null']);
    });
  });

  // The floating top tab bar covers the native header of a pane that touches the window top, so
  // the frames start below it and the pane drops its own top inset.
  describe('under a floating top tab bar, 1376x1032 with a 32 pt top inset', () => {
    const ROOT_INSETS = { top: 32, right: 0, bottom: 20, left: 0 };

    const renderUnderBar = () =>
      render(
        <SafeAreaInsetsContext.Provider value={ROOT_INSETS}>
          <TwoPaneLayout
            companion={<InsetProbe name="companion" />}
            primary={<InsetProbe name="primary" />}
          />
        </SafeAreaInsetsContext.Provider>,
      );

    beforeEach(() => {
      mockUseTabBarEdge.mockReturnValue('top');
      mockWindow.width = 1376;
      mockWindow.height = 1032;
    });

    it('starts both pane frames and the divider at the band bottom, y 76', async () => {
      await renderUnderBar();

      for (const testID of ['two-pane-companion', 'two-pane-divider', 'two-pane-primary']) {
        expect(frameOf(testID)).toMatchObject({ y: 76, height: 956 });
      }
    });

    it('hands the primary pane a zero top inset and the other window insets', async () => {
      await renderUnderBar();

      expect(JSON.parse(screen.getByTestId('inset-primary').children.join(''))).toEqual({
        ...ROOT_INSETS,
        top: 0,
      });
      expect(JSON.parse(screen.getByTestId('inset-companion').children.join(''))).toEqual({
        ...ROOT_INSETS,
        top: 0,
      });
    });

    it('tells both panes that the top edge is not the window top', async () => {
      await renderUnderBar();

      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf('columns', 'primary', true)),
      ]);
      expect(screen.getByTestId('probe-companion').children).toEqual([
        JSON.stringify(paneContextOf('columns', 'companion', true)),
      ]);
    });

    it('moves only the companion in rows, and zeroes only its top inset', async () => {
      mockUseLayoutMode.mockReturnValue('rows');
      mockWindow.width = 683;
      mockWindow.height = 909;
      await renderUnderBar();

      expect(frameOf('two-pane-companion').y).toBe(76);
      expect(frameOf('two-pane-primary').y).toBe(
        frameOf('two-pane-companion').y + frameOf('two-pane-companion').height + HAIRLINE,
      );
      expect(JSON.parse(screen.getByTestId('inset-companion').children.join('')).top).toBe(0);
      expect(JSON.parse(screen.getByTestId('inset-primary').children.join(''))).toEqual(
        ROOT_INSETS,
      );
      expect(screen.getByTestId('probe-primary').children).toEqual([
        JSON.stringify(paneContextOf('rows', 'primary')),
      ]);
    });

    it('keeps a 10 pt inset window band at 54', async () => {
      await render(
        <SafeAreaInsetsContext.Provider value={{ ...ROOT_INSETS, top: 10 }}>
          <TwoPaneLayout
            companion={<InsetProbe name="companion" />}
            primary={<InsetProbe name="primary" />}
          />
        </SafeAreaInsetsContext.Provider>,
      );

      expect(frameOf('two-pane-primary')).toMatchObject({ y: 54, height: 1032 - 54 });
    });
  });

  it('keeps the frames at the window top and the insets under a bottom tab bar (Duo 951x669)', async () => {
    const windowInsets = { top: 24, right: 0, bottom: 0, left: 0 };
    mockUseTabBarEdge.mockReturnValue('bottom');
    await render(
      <SafeAreaInsetsContext.Provider value={windowInsets}>
        <TwoPaneLayout
          companion={<InsetProbe name="companion" />}
          primary={<InsetProbe name="primary" />}
        />
      </SafeAreaInsetsContext.Provider>,
    );

    expect(frameOf('two-pane-companion').y).toBe(0);
    expect(frameOf('two-pane-primary').y).toBe(0);
    expect(frameOf('two-pane-primary').height).toBe(669);

    for (const name of ['companion', 'primary'] as const) {
      expect(JSON.parse(screen.getByTestId(`inset-${name}`).children.join(''))).toEqual(
        windowInsets,
      );
      expect(screen.getByTestId(`probe-${name}`).children).toEqual([
        JSON.stringify(paneContextOf('columns', name)),
      ]);
    }
  });

  // A pane child keeps its state across a band flip and a mode switch: the wrapper must not
  // change the element type above it.
  describe('keeps each pane child mounted', () => {
    const tree = () => (
      <SafeAreaInsetsContext.Provider value={{ top: 32, right: 0, bottom: 20, left: 0 }}>
        <TwoPaneLayout
          companion={<MountProbe name="companion" />}
          primary={<MountProbe name="primary" />}
        />
      </SafeAreaInsetsContext.Provider>
    );

    beforeEach(() => {
      mountLog.length = 0;
      mockWindow.width = 1376;
      mockWindow.height = 1032;
    });

    it('across a tab bar edge flip top, bottom, top', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await render(tree());
      mockUseTabBarEdge.mockReturnValue('bottom');
      await view.rerender(tree());
      mockUseTabBarEdge.mockReturnValue('top');
      await view.rerender(tree());

      expect([...mountLog].sort()).toEqual(['companion', 'primary']);
    });

    it('across columns to rows under a top bar', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await render(tree());
      mockUseLayoutMode.mockReturnValue('rows');
      mockWindow.width = 683;
      mockWindow.height = 909;
      await view.rerender(tree());

      expect([...mountLog].sort()).toEqual(['companion', 'primary']);
    });
  });

  describe('the top inset a pane child reads, as the tab bar edge flips', () => {
    const WINDOW_INSETS = { top: 32, right: 0, bottom: 20, left: 0 };

    const tree = () => (
      <SafeAreaInsetsContext.Provider value={WINDOW_INSETS}>
        <TwoPaneLayout
          companion={<InsetProbe name="companion" />}
          primary={<InsetProbe name="primary" />}
        />
      </SafeAreaInsetsContext.Provider>
    );

    const topInsetOf = (name: 'companion' | 'primary'): number =>
      JSON.parse(screen.getByTestId(`inset-${name}`).children.join('')).top;

    beforeEach(() => {
      mockWindow.width = 1376;
      mockWindow.height = 1032;
    });

    it('goes from zero back to the window inset when the bar moves from top to bottom', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await render(tree());
      const before = [topInsetOf('companion'), topInsetOf('primary')];
      mockUseTabBarEdge.mockReturnValue('bottom');
      await view.rerender(tree());

      expect(before).toEqual([0, 0]);
      expect([topInsetOf('companion'), topInsetOf('primary')]).toEqual([32, 32]);
    });

    it('goes from the window inset to zero when the bar moves from bottom to top', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      const view = await render(tree());
      const before = [topInsetOf('companion'), topInsetOf('primary')];
      mockUseTabBarEdge.mockReturnValue('top');
      await view.rerender(tree());

      expect(before).toEqual([32, 32]);
      expect([topInsetOf('companion'), topInsetOf('primary')]).toEqual([0, 0]);
    });
  });

  describe.each([
    [1376, 1032],
    [1100, 820],
    [1032, 1376],
  ])('a %i x %i window', (width, height) => {
    const half = (width - HAIRLINE) / 2;

    beforeEach(() => {
      mockWindow.width = width;
      mockWindow.height = height;
    });

    it('puts the panes side by side, each half of the window less the divider', async () => {
      await renderLayout();

      expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: half, height });
      expect(frameOf('two-pane-divider').x).toBe(half);
      expect(frameOf('two-pane-primary')).toEqual({
        x: half + HAIRLINE,
        y: 0,
        width: half,
        height,
      });
    });

    it('tells each child the width of its own half', async () => {
      await renderProbes();

      expect(Number(screen.getByTestId('width-companion').children[0])).toBe(half);
      expect(Number(screen.getByTestId('width-primary').children[0])).toBe(half);
    });
  });

  // A title sizes itself by the pane's own header, so each child is told its pane's frame width.
  describe('the width of the pane each child is rendered in', () => {
    it('is half the window less the divider in columns', async () => {
      await renderProbes();

      expect(screen.getByTestId('width-companion').children).toEqual([String(HALF)]);
      expect(screen.getByTestId('width-primary').children).toEqual([String(HALF)]);
    });

    it('is each side of the fold when the window is folded in columns', async () => {
      mockUseFoldRegion.mockReturnValue({ x: 400, y: 0, width: 11, height: 669 });
      await renderProbes();

      expect(screen.getByTestId('width-companion').children).toEqual(['400']);
      expect(screen.getByTestId('width-primary').children).toEqual([String(951 - 411)]);
    });

    it('is the whole window in rows', async () => {
      mockUseLayoutMode.mockReturnValue('rows');
      await renderProbes();

      expect(screen.getByTestId('width-companion').children).toEqual(['951']);
      expect(screen.getByTestId('width-primary').children).toEqual(['951']);
    });

    it('is no width at all in single mode, where the window is the screen', async () => {
      mockUseLayoutMode.mockReturnValue('single');
      await renderProbes();

      expect(screen.getByTestId('width-primary').children).toEqual(['null']);
    });
  });

  // A pane that takes the whole window is the window as far as its screens are concerned: no
  // pane context, no pane width. The other pane stays where it was, mounted and out of reach.
  describe('a pane that takes the whole window', () => {
    const WINDOW_INSETS = { top: 32, right: 0, bottom: 20, left: 0 };

    const renderExpanded = (expandedPane: 'companion' | 'primary' | null | undefined) =>
      render(
        <SafeAreaInsetsContext.Provider value={WINDOW_INSETS}>
          <TwoPaneLayout
            expandedPane={expandedPane}
            companion={<InsetProbe name="companion" />}
            primary={<InsetProbe name="primary" />}
          />
        </SafeAreaInsetsContext.Provider>,
      );

    const styleOf = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID, WITH_HIDDEN).props.style);

    it.each([
      [
        'primary',
        'two-pane-primary',
        'two-pane-companion',
        { x: 0, y: 0, width: HALF, height: 669 },
      ],
      [
        'companion',
        'two-pane-companion',
        'two-pane-primary',
        { x: HALF + HAIRLINE, y: 0, width: HALF, height: 669 },
      ],
    ] as const)(
      'is the %s pane across the window, while the other pane keeps its frame hidden',
      async (expandedPane, shownId, hiddenId, hiddenFrame) => {
        await renderExpanded(expandedPane);

        expect(frameOf(shownId)).toEqual({ x: 0, y: 0, width: 951, height: 669 });
        expect(styleOf(shownId).opacity).toBeUndefined();
        expect(screen.getByTestId(shownId, WITH_HIDDEN).props.pointerEvents).toBeUndefined();
        expect(
          screen.getByTestId(shownId, WITH_HIDDEN).props.accessibilityElementsHidden,
        ).toBeUndefined();

        expect(frameOf(hiddenId)).toEqual(hiddenFrame);
        expect(styleOf(hiddenId).opacity).toBe(0);
        expect(screen.getByTestId(hiddenId, WITH_HIDDEN).props.pointerEvents).toBe('none');
        expect(screen.getByTestId(hiddenId, WITH_HIDDEN).props.accessibilityElementsHidden).toBe(
          true,
        );
        expect(screen.queryByTestId('two-pane-divider')).toBeNull();
      },
    );

    it.each([null, 'primary', 'companion'] as const)(
      'keeps both pane views native whichever pane is expanded (%s)',
      async (expandedPane) => {
        await renderExpanded(expandedPane);

        expect(screen.getByTestId('two-pane-companion', WITH_HIDDEN).props.collapsable).toBe(false);
        expect(screen.getByTestId('two-pane-primary', WITH_HIDDEN).props.collapsable).toBe(false);
      },
    );

    it('tells its child it is no pane, with no width, and the hidden child its own pane', async () => {
      await renderExpanded('primary');

      expect(screen.getByTestId('probe-primary').children).toEqual(['null']);
      expect(screen.getByTestId('width-primary').children).toEqual(['null']);
      expect(screen.getByTestId('probe-companion', WITH_HIDDEN).children).toEqual([
        JSON.stringify(paneContextOf('columns', 'companion')),
      ]);
      expect(screen.getByTestId('width-companion', WITH_HIDDEN).children).toEqual([String(HALF)]);
    });

    it('lies below the top-bar band under a top tab bar, with a zero top inset', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      mockWindow.width = 1376;
      mockWindow.height = 1032;
      await renderExpanded('primary');

      expect(frameOf('two-pane-primary')).toEqual({ x: 0, y: 76, width: 1376, height: 956 });
      expect(JSON.parse(screen.getByTestId('inset-primary').children.join('')).top).toBe(0);
    });

    it('reads the window top inset under a bottom tab bar', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      await renderExpanded('primary');

      expect(frameOf('two-pane-primary').y).toBe(0);
      expect(JSON.parse(screen.getByTestId('inset-primary').children.join('')).top).toBe(32);
    });

    it('is the window in rows too', async () => {
      mockUseLayoutMode.mockReturnValue('rows');
      await renderExpanded('companion');

      expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: 951, height: 669 });
      expect(styleOf('two-pane-primary').opacity).toBe(0);
    });

    it('lays out one pane only in single mode, as it does without it', async () => {
      mockUseLayoutMode.mockReturnValue('single');
      await renderExpanded('primary');

      expect(screen.queryByTestId('two-pane-primary')).toBeNull();
      expect(screen.getByTestId('probe-primary').children).toEqual(['null']);
    });

    it('keeps each child mounted as the pane takes the window and gives it back', async () => {
      mountLog.length = 0;
      const tree = (expandedPane: 'primary' | null) => (
        <TwoPaneLayout
          expandedPane={expandedPane}
          companion={<MountProbe name="companion" />}
          primary={<MountProbe name="primary" />}
        />
      );

      const view = await render(tree(null));
      await view.rerender(tree('primary'));
      await view.rerender(tree(null));

      expect([...mountLog].sort()).toEqual(['companion', 'primary']);
      expect(screen.getByTestId('two-pane-divider')).toBeTruthy();
    });
  });

  // A layer is the window over both panes: it never moves them, so a screen in it shows over
  // panes that keep their frame, their context and their width, and it takes touches only while
  // it holds a screen.
  describe('a layer over both panes', () => {
    const WINDOW_INSETS = { top: 32, right: 0, bottom: 20, left: 0 };

    const renderLayer = (isLayerShown?: boolean) =>
      render(
        <SafeAreaInsetsContext.Provider value={WINDOW_INSETS}>
          <TwoPaneLayout
            isLayerShown={isLayerShown}
            layer={<InsetProbe name="layer" />}
            companion={<InsetProbe name="companion" />}
            primary={<InsetProbe name="primary" />}
          />
        </SafeAreaInsetsContext.Provider>,
      );

    const layerProps = () => screen.getByTestId('two-pane-layer', WITH_HIDDEN).props;

    it('draws no layer view without a layer', async () => {
      await renderLayout();

      expect(screen.queryByTestId('two-pane-layer', WITH_HIDDEN)).toBeNull();
    });

    it('is the last view, after the divider, across the whole window', async () => {
      await renderLayer(true);

      const root = screen.toJSON();
      const order =
        root !== null && !Array.isArray(root)
          ? (root.children ?? []).map((child) =>
              typeof child === 'string' ? child : child.props.testID,
            )
          : [];

      expect(order).toEqual([
        'two-pane-companion',
        'two-pane-divider',
        'two-pane-primary',
        'two-pane-layer',
      ]);
      expect(frameOf('two-pane-layer')).toEqual({ x: 0, y: 0, width: 951, height: 669 });
      expect(layerProps().collapsable).toBe(false);
    });

    it.each([true, false])(
      'leaves both panes, the divider and their frames as they were when the layer is shown: %s',
      async (isLayerShown) => {
        await renderLayer(isLayerShown);

        expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: HALF, height: 669 });
        expect(frameOf('two-pane-primary')).toEqual({
          x: HALF + HAIRLINE,
          y: 0,
          width: HALF,
          height: 669,
        });
        expect(frameOf('two-pane-divider')).toEqual({
          x: HALF,
          y: 0,
          width: HAIRLINE,
          height: 669,
        });

        for (const testID of ['two-pane-companion', 'two-pane-primary']) {
          const pane = screen.getByTestId(testID, WITH_HIDDEN);

          expect(StyleSheet.flatten(pane.props.style).opacity).toBeUndefined();
          expect(pane.props.pointerEvents).toBeUndefined();
          expect(pane.props.accessibilityElementsHidden).toBeUndefined();
        }
      },
    );

    it('takes touches and the VoiceOver focus only while it is shown', async () => {
      const view = await renderLayer(true);

      expect(layerProps().pointerEvents).toBeUndefined();
      expect(layerProps().accessibilityViewIsModal).toBe(true);

      await view.rerender(
        <SafeAreaInsetsContext.Provider value={WINDOW_INSETS}>
          <TwoPaneLayout
            isLayerShown={false}
            layer={<InsetProbe name="layer" />}
            companion={<InsetProbe name="companion" />}
            primary={<InsetProbe name="primary" />}
          />
        </SafeAreaInsetsContext.Provider>,
      );

      expect(layerProps().pointerEvents).toBe('none');
      expect(layerProps().accessibilityViewIsModal).toBeUndefined();
    });

    it('is not shown when no flag is given', async () => {
      await renderLayer();

      expect(layerProps().pointerEvents).toBe('none');
    });

    it('tells its child it is no pane, with no width, and each pane its own', async () => {
      await renderLayer(true);

      expect(screen.getByTestId('probe-layer', WITH_HIDDEN).children).toEqual(['null']);
      expect(screen.getByTestId('width-layer', WITH_HIDDEN).children).toEqual(['null']);
      // A shown layer is a modal view, which Testing Library takes to hide the panes beside it.
      expect(screen.getByTestId('probe-companion', WITH_HIDDEN).children).toEqual([
        JSON.stringify(paneContextOf('columns', 'companion')),
      ]);
      expect(screen.getByTestId('probe-primary', WITH_HIDDEN).children).toEqual([
        JSON.stringify(paneContextOf('columns', 'primary')),
      ]);
      expect(screen.getByTestId('width-companion', WITH_HIDDEN).children).toEqual([String(HALF)]);
      expect(screen.getByTestId('width-primary', WITH_HIDDEN).children).toEqual([String(HALF)]);
    });

    it('lies below the top-bar band under a top tab bar, with a zero top inset, and moves no pane', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      mockWindow.width = 1376;
      mockWindow.height = 1032;
      await renderLayer(true);

      expect(frameOf('two-pane-layer')).toEqual({ x: 0, y: 76, width: 1376, height: 956 });
      expect(JSON.parse(screen.getByTestId('inset-layer').children.join('')).top).toBe(0);
      expect(frameOf('two-pane-primary')).toMatchObject({ y: 76, height: 956 });
    });

    it('reads the window top inset under a bottom tab bar', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      await renderLayer(true);

      expect(frameOf('two-pane-layer').y).toBe(0);
      expect(JSON.parse(screen.getByTestId('inset-layer').children.join('')).top).toBe(32);
    });

    it('is the window in rows too', async () => {
      mockUseLayoutMode.mockReturnValue('rows');
      await renderLayer(true);

      expect(frameOf('two-pane-layer')).toEqual({ x: 0, y: 0, width: 951, height: 669 });
    });

    it('is left out in single mode, where the window is the screen', async () => {
      mockUseLayoutMode.mockReturnValue('single');
      await renderLayer(true);

      expect(screen.queryByTestId('two-pane-layer', WITH_HIDDEN)).toBeNull();
      expect(screen.queryByTestId('probe-layer', WITH_HIDDEN)).toBeNull();
    });

    it('keeps every child mounted as the layer is shown and hidden again', async () => {
      mountLog.length = 0;
      const tree = (isLayerShown: boolean) => (
        <TwoPaneLayout
          isLayerShown={isLayerShown}
          layer={<MountProbe name="layer" />}
          companion={<MountProbe name="companion" />}
          primary={<MountProbe name="primary" />}
        />
      );

      const view = await render(tree(false));
      await view.rerender(tree(true));
      await view.rerender(tree(false));

      expect([...mountLog].sort()).toEqual(['companion', 'layer', 'primary']);
    });
  });
});
