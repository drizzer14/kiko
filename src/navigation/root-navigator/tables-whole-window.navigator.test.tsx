import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { reportWindow } from '@kiko/test-support/window-size';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { answerFilterData } from '@kiko/test-support/statistics-filter-data';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { SETTLE_DELAY_MS } from '../pane-stack';

import RootNavigator from './root.navigator';

/**
 * The Tables screen is in a layer over both panes: on the real RootNavigator, the panes keep their
 * frames, their routes and their screens as Tables opens and as it closes, and the layer is the
 * window to its screens. The transaction form is a stand-in, as in the other navigator suites: its
 * route is under test, not its fields.
 */

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: () => <View testID="transaction-form-stub" /> };
});

const mockLayout = { mode: 'columns' as 'single' | 'columns', listeners: new Set<() => void>() };

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    ...jest.requireActual('@kiko/display-regions'),
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockLayout.listeners.add(listener);

          return () => mockLayout.listeners.delete(listener);
        },
        () => mockLayout.mode,
      ),
    useFoldRegion: () => null,
  };
});

// A tab mounts on its first focus and stays mounted, as the native bottom tabs do.
jest.mock('@bottom-tabs/react-navigation', () => {
  const native = jest.requireActual('@react-navigation/native');
  const LazyTabs = jest.requireActual('@kiko/test-support/lazy-tabs').default;

  return { createNativeBottomTabNavigator: native.createNavigatorFactory(LazyTabs) };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

type StackRoute = {
  key: string;
  name: string;
  params?: { period?: { kind: string; year?: number } };
};
type StackState = { key: string; routes: StackRoute[]; panes: Record<string, string | undefined> };

const BUTTON = 'statistics-open-tables';
const COMPANION = 'two-pane-companion';
const PRIMARY = 'two-pane-primary';
const DIVIDER = 'two-pane-divider';
const LAYER = 'two-pane-layer';
const FORM = 'transaction-form-stub';
const TABLES = 'tables-period';
const WINDOW = { width: 951, height: 669 };
const YEAR = new Date().getFullYear();

// Testing Library leaves a view hidden from accessibility out of its queries by default, and a
// shown layer is a modal view, which hides the panes beside it.
const WITH_HIDDEN = { includeHiddenElements: true } as const;

const renderRoot = async () => {
  const rendered = await render(
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>,
    { wrapper: GestureRootWrapper },
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return rendered;
};

type Rendered = Awaited<ReturnType<typeof renderRoot>>;

const goToTab = async (tab: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate(tab);
  });
};

const setLayout = async (mode: 'single' | 'columns'): Promise<void> => {
  await act(async () => {
    mockLayout.mode = mode;

    for (const listener of mockLayout.listeners) {
      listener();
    }
  });
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

const stackOf = (tab: string): StackState =>
  navigationRef.getRootState()?.routes.find(({ name }) => name === tab)?.state as StackState;

const namesOf = (tab: string): string[] => stackOf(tab).routes.map(({ name }) => name);

// A tab that was visited stays mounted behind the focused one, with `display: none` on its root,
// and has panes of its own; a query means the ones of the tab on screen.
type Instance = ReturnType<Rendered['getByTestId']>;

const isInFocusedTab = (instance: Instance): boolean => {
  for (let node = instance.parent; node !== null; node = node.parent) {
    if (StyleSheet.flatten(node.props.style)?.display === 'none') {
      return false;
    }
  }

  return true;
};

const allOf = (rendered: Rendered, testID: string): Instance[] =>
  rendered.queryAllByTestId(testID, WITH_HIDDEN).filter(isInFocusedTab);

const oneOf = (rendered: Rendered, testID: string): Instance => {
  const found = allOf(rendered, testID);

  expect(found).toHaveLength(1);

  return found[0];
};

// The content view of the Tables screen, whose parent is the screen's SafeAreaView.
const tablesContent = (rendered: Rendered): Instance | null => {
  let node = rendered.getByTestId(TABLES).parent;

  while (node !== null && node.props.testID !== 'screen-content') {
    node = node.parent;
  }

  return node;
};

const ancestorsOf = (instance: Instance): Instance[] => {
  const found: Instance[] = [];

  for (let node = instance.parent; node !== null; node = node.parent) {
    found.push(node);
  }

  return found;
};

// The pane or the layer an instance is rendered in.
const placeOf = (instance: Instance): string | null =>
  ancestorsOf(instance)
    .map((node) => node.props.testID)
    .find((testID) => testID === COMPANION || testID === PRIMARY || testID === LAYER) ?? null;

const styleOf = (rendered: Rendered, testID: string) =>
  StyleSheet.flatten(oneOf(rendered, testID).props.style);

const frameOf = (rendered: Rendered, testID: string) => {
  const { left, top, width, height } = styleOf(rendered, testID);

  return { x: left, y: top, width, height };
};

// The frames of both panes and the divider, or null where there is none.
const framesOf = (rendered: Rendered) => ({
  companion: frameOf(rendered, COMPANION),
  primary: frameOf(rendered, PRIMARY),
  divider: allOf(rendered, DIVIDER).length === 1 ? frameOf(rendered, DIVIDER) : null,
});

// Two panes side by side, each in a part of the window, none hidden or out of reach.
const isShared = (rendered: Rendered): boolean => {
  const frames = framesOf(rendered);

  return (
    frames.divider !== null &&
    [COMPANION, PRIMARY].every((testID) => {
      const { props } = oneOf(rendered, testID);

      return (
        styleOf(rendered, testID).opacity === undefined &&
        props.pointerEvents === undefined &&
        props.accessibilityElementsHidden === undefined
      );
    }) &&
    frames.companion.width < WINDOW.width &&
    frames.primary.width < WINDOW.width
  );
};

// The layer holds a page: it takes touches and the screen reader focus.
const isLayerOpen = (rendered: Rendered): boolean => {
  const { props } = oneOf(rendered, LAYER);

  return props.pointerEvents === undefined && props.accessibilityViewIsModal === true;
};

// The layer holds only its placeholder root: it takes no touch and no focus.
const isLayerAtRest = (rendered: Rendered): boolean => {
  const { props } = oneOf(rendered, LAYER);

  return props.pointerEvents === 'none' && props.accessibilityViewIsModal === undefined;
};

const pressTables = async (rendered: Rendered): Promise<void> => {
  await fireEvent.press(rendered.getByTestId(BUTTON));
};

const pickYear = async (rendered: Rendered, year: number): Promise<void> => {
  await fireEvent.press(rendered.getByTestId(TABLES));
  await fireEvent.press(rendered.getByTestId(`tables-period-option-year-${year}`));
};

// What the native stack sends when the user's Back or swipe has finished: the screen's own
// dismissal, which the stack turns into a pop that names the screen it came from.
const dismissNatively = async (instance: Instance): Promise<void> => {
  const owner = ancestorsOf(instance).find((node) => typeof node.props.onDismissed === 'function');

  expect(owner).toBeDefined();

  await act(async () => {
    owner?.props.onDismissed({ nativeEvent: { dismissCount: 1 } });
  });
};

const goBack = async (): Promise<void> => {
  await act(async () => {
    navigationRef.goBack();
  });
};

describe('Tables is in a layer over both panes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLayout.mode = 'columns';
    reportWindow('regular', WINDOW.width, WINDOW.height);
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(async () => {
    await resetStatisticsFilterSelection();
    reportWindow('compact', 393, 852);
    jest.useRealTimers();
  });

  describe('on the Home tab with two panes', () => {
    it('shares the window between Home and Statistics until Tables opens, with the layer at rest', async () => {
      const rendered = await renderRoot();

      expect(isShared(rendered)).toBe(true);
      expect(isLayerAtRest(rendered)).toBe(true);
      expect(allOf(rendered, TABLES)).toHaveLength(0);
      expect(namesOf('HomeTab')).toEqual(['Home']);
    });

    it('opens Tables over Home, so Back is there, and moves neither pane', async () => {
      const rendered = await renderRoot();
      const before = framesOf(rendered);
      const layer = oneOf(rendered, LAYER);

      await pressTables(rendered);

      expect(namesOf('HomeTab')).toEqual(['Home', 'Tables']);
      expect(framesOf(rendered)).toEqual(before);
      expect(allOf(rendered, DIVIDER)).toHaveLength(1);
      expect(styleOf(rendered, PRIMARY).opacity).toBeUndefined();
      expect(styleOf(rendered, COMPANION).opacity).toBeUndefined();
      expect(oneOf(rendered, LAYER)).toBe(layer);
      expect(isLayerOpen(rendered)).toBe(true);
      expect(frameOf(rendered, LAYER)).toEqual({ x: 0, y: 0, ...WINDOW });
      expect(stackOf('HomeTab').panes[stackOf('HomeTab').routes[0].key]).toBe('primary');
    });

    it('shows Tables once, in the layer, and Home in its pane', async () => {
      const rendered = await renderRoot();

      await pressTables(rendered);

      expect(allOf(rendered, TABLES)).toHaveLength(1);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
    });

    // The layer tells its screens they are in no pane, so Tables reads as the single stack's: the
    // header owns the top inset, the other edges are the window's, and the content starts at the
    // base padding with no top-bar pill.
    it('lays Tables out as the window under its header: no top edge, the base padding', async () => {
      const rendered = await renderRoot();

      await pressTables(rendered);

      const content = tablesContent(rendered);

      expect(content?.parent?.props.edges).toEqual({
        top: 'off',
        right: 'additive',
        bottom: 'additive',
        left: 'additive',
      });
      expect(StyleSheet.flatten(content?.props.style).paddingTop).toBe(darkTheme.spacing(4));
    });

    it('keeps the Statistics beside Home mounted, with no route made for it', async () => {
      const rendered = await renderRoot();
      const before = oneOf(rendered, BUTTON);

      await pressTables(rendered);

      expect(namesOf('HomeTab')).not.toContain('Statistics');
      expect(allOf(rendered, BUTTON)).toHaveLength(1);
      expect(oneOf(rendered, BUTTON)).toBe(before);
      expect(placeOf(oneOf(rendered, BUTTON))).toBe(COMPANION);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
    });

    it('goes back to the panes as they were: the same frames, screens and routes', async () => {
      const rendered = await renderRoot();
      const before = framesOf(rendered);
      const button = oneOf(rendered, BUTTON);
      const routes = stackOf('HomeTab').routes;

      await pressTables(rendered);
      await goBack();

      expect(namesOf('HomeTab')).toEqual(['Home']);
      expect(stackOf('HomeTab').routes).toEqual(routes);
      expect(framesOf(rendered)).toEqual(before);
      expect(isShared(rendered)).toBe(true);
      expect(isLayerAtRest(rendered)).toBe(true);
      expect(oneOf(rendered, BUTTON)).toBe(button);
      expect(allOf(rendered, TABLES)).toHaveLength(0);
    });

    // The Back the user does: the native stack reports the finished dismissal of Tables, and the
    // stack turns it into a pop from that screen.
    it('goes back when the native stack reports the dismissal of Tables', async () => {
      const rendered = await renderRoot();
      const before = framesOf(rendered);
      const routes = stackOf('HomeTab').routes;

      await pressTables(rendered);
      await dismissNatively(rendered.getByTestId(TABLES));

      expect(stackOf('HomeTab').routes).toEqual(routes);
      expect(framesOf(rendered)).toEqual(before);
      expect(isLayerAtRest(rendered)).toBe(true);
    });

    it('opens Tables again after Back, with the layer made once', async () => {
      const rendered = await renderRoot();
      const layer = oneOf(rendered, LAYER);

      await pressTables(rendered);
      await goBack();
      await pressTables(rendered);

      expect(oneOf(rendered, LAYER)).toBe(layer);
      expect(allOf(rendered, TABLES)).toHaveLength(1);
      expect(isLayerOpen(rendered)).toBe(true);
    });

    it('opens Tables over a Statistics route that is there, which keeps its pane', async () => {
      mockLayout.mode = 'single';
      const rendered = await renderRoot();

      await act(async () => {
        navigationRef.navigate('HomeTab', { screen: 'Statistics' });
      });
      await setLayout('columns');

      expect(namesOf('HomeTab')).toEqual(['Home', 'Statistics']);
      expect(isShared(rendered)).toBe(true);

      const before = framesOf(rendered);
      const button = oneOf(rendered, BUTTON);

      await pressTables(rendered);

      expect(namesOf('HomeTab')).toEqual(['Home', 'Statistics', 'Tables']);
      expect(framesOf(rendered)).toEqual(before);
      expect(oneOf(rendered, BUTTON)).toBe(button);
      expect(placeOf(button)).toBe(COMPANION);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
      expect(isLayerOpen(rendered)).toBe(true);

      await goBack();

      expect(namesOf('HomeTab')).toEqual(['Home', 'Statistics']);
      expect(framesOf(rendered)).toEqual(before);
      expect(oneOf(rendered, BUTTON)).toBe(button);
    });
  });

  describe('on the Statistics tab with two panes', () => {
    it('shares the window between Statistics and Home until Tables opens, with the layer at rest', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(isShared(rendered)).toBe(true);
      expect(isLayerAtRest(rendered)).toBe(true);
    });

    it('opens Tables over Statistics, which stays in its pane with the Home beside it', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      const before = framesOf(rendered);
      const button = oneOf(rendered, BUTTON);

      await pressTables(rendered);

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(framesOf(rendered)).toEqual(before);
      expect(oneOf(rendered, BUTTON)).toBe(button);
      expect(placeOf(button)).toBe(PRIMARY);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
      expect(allOf(rendered, TABLES)).toHaveLength(1);
      expect(isLayerOpen(rendered)).toBe(true);
    });

    it('goes back to Statistics as it was, the same frames and the same screen', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      const before = framesOf(rendered);
      const button = oneOf(rendered, BUTTON);

      await pressTables(rendered);
      await goBack();

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(framesOf(rendered)).toEqual(before);
      expect(isShared(rendered)).toBe(true);
      expect(isLayerAtRest(rendered)).toBe(true);
      expect(oneOf(rendered, BUTTON)).toBe(button);
    });

    it('goes back when the native stack reports the dismissal of Tables', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      const before = framesOf(rendered);

      await pressTables(rendered);
      await dismissNatively(rendered.getByTestId(TABLES));

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(framesOf(rendered)).toEqual(before);
      expect(isLayerAtRest(rendered)).toBe(true);
    });

    // The user's ruling "A: It stays (Recommended)": a form that is open stays open under Tables,
    // and Back returns to it as it was, the same route and the same screen, so its draft is kept.
    describe('with a form open over Statistics', () => {
      const openForm = async (): Promise<void> => {
        await act(async () => {
          navigationRef.dispatch({
            type: 'PANE_OPEN',
            payload: { openerKey: 'pane-default:companion', route: { name: 'TransactionForm' } },
            target: stackOf('StatisticsTab').key,
          });
        });
      };

      it('keeps the form under Tables, in its pane, with the layer over both', async () => {
        const rendered = await renderRoot();

        await goToTab('StatisticsTab');
        await openForm();

        expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Home', 'TransactionForm']);
        expect(isShared(rendered)).toBe(true);

        const before = framesOf(rendered);
        const form = oneOf(rendered, FORM);

        await pressTables(rendered);

        expect(namesOf('StatisticsTab')).toEqual([
          'Statistics',
          'Home',
          'TransactionForm',
          'Tables',
        ]);
        expect(framesOf(rendered)).toEqual(before);
        expect(oneOf(rendered, FORM)).toBe(form);
        expect(placeOf(form)).toBe(COMPANION);
        expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
      });

      it('goes back to the form as it was: the same route, key and screen', async () => {
        const rendered = await renderRoot();

        await goToTab('StatisticsTab');
        await openForm();

        const before = framesOf(rendered);
        const form = oneOf(rendered, FORM);
        const routes = stackOf('StatisticsTab').routes;

        await pressTables(rendered);
        await goBack();

        expect(stackOf('StatisticsTab').routes).toEqual(routes);
        expect(framesOf(rendered)).toEqual(before);
        expect(oneOf(rendered, FORM)).toBe(form);
        expect(isShared(rendered)).toBe(true);
        expect(isLayerAtRest(rendered)).toBe(true);
      });

      it('goes back to the form when the native stack reports the dismissal of Tables', async () => {
        const rendered = await renderRoot();

        await goToTab('StatisticsTab');
        await openForm();

        const form = oneOf(rendered, FORM);
        const routes = stackOf('StatisticsTab').routes;

        await pressTables(rendered);
        await dismissNatively(rendered.getByTestId(TABLES));

        expect(stackOf('StatisticsTab').routes).toEqual(routes);
        expect(oneOf(rendered, FORM)).toBe(form);
      });
    });
  });

  describe('with a form and no Tables', () => {
    it.each(['HomeTab', 'StatisticsTab'])(
      'on the %s: the panes share the window and the layer is at rest',
      async (tab) => {
        const rendered = await renderRoot();

        await goToTab(tab);
        await act(async () => {
          navigationRef.dispatch({
            type: 'PANE_OPEN',
            payload: { openerKey: 'pane-default:companion', route: { name: 'TransactionForm' } },
            target: stackOf(tab).key,
          });
        });

        expect(rendered.getByTestId(FORM)).toBeTruthy();
        expect(isShared(rendered)).toBe(true);
        expect(isLayerAtRest(rendered)).toBe(true);
      },
    );
  });

  describe('with one pane', () => {
    it('has no panes and no layer, and Tables is not capped at the pane max width on a regular window', async () => {
      mockLayout.mode = 'single';
      reportWindow('regular', 669, 951);
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await pressTables(rendered);

      const content = tablesContent(rendered);

      expect(allOf(rendered, PRIMARY)).toHaveLength(0);
      expect(allOf(rendered, LAYER)).toHaveLength(0);
      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(content).not.toBeNull();
      expect(StyleSheet.flatten(content?.parent?.props.style).maxWidth).toBeUndefined();
      expect(darkTheme.layout.paneMaxWidth).toBeLessThan(669);
    });

    it('shows Home and Statistics as they were, with no panes', async () => {
      mockLayout.mode = 'single';
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      expect(allOf(rendered, PRIMARY)).toHaveLength(0);
      expect(allOf(rendered, COMPANION)).toHaveLength(0);
      expect(allOf(rendered, LAYER)).toHaveLength(0);
      expect(rendered.getByTestId(BUTTON)).toBeTruthy();
    });
  });

  // This row passes on any code that keeps the route in the state: it says the year survives the
  // switch and the layer is there again, nothing about how a Back behaves after the cycle on a
  // device.
  describe('a fold and an unfold with Tables open', () => {
    it.each(['HomeTab', 'StatisticsTab'])(
      'keeps the year picked on the %s, and shows Tables in the layer again',
      async (tab) => {
        const rendered = await renderRoot();

        await goToTab(tab);
        await pressTables(rendered);
        await pickYear(rendered, YEAR);

        await setLayout('single');

        expect(allOf(rendered, PRIMARY)).toHaveLength(0);
        expect(allOf(rendered, LAYER)).toHaveLength(0);
        expect(rendered.getByTestId(TABLES)).toHaveTextContent(String(YEAR), {
          exact: false,
        });

        await setLayout('columns');

        expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
        expect(isLayerOpen(rendered)).toBe(true);
        expect(allOf(rendered, DIVIDER)).toHaveLength(1);
        expect(rendered.getByTestId(TABLES)).toHaveTextContent(String(YEAR), {
          exact: false,
        });
        expect(stackOf(tab).routes.at(-1)?.params?.period).toEqual({ kind: 'year', year: YEAR });

        await goBack();

        expect(isLayerAtRest(rendered)).toBe(true);
        expect(allOf(rendered, TABLES)).toHaveLength(0);
      },
    );
  });
});
