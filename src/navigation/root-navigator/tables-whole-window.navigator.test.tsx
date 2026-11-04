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
 * The Tables screen takes the whole window: on the real RootNavigator, the pane that holds Tables
 * fills the window, the other pane stays mounted and hidden, and no screen is made again. The
 * transaction form is a stand-in, as in the other navigator suites: its route is under test, not
 * its fields.
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
const WINDOW = { width: 951, height: 669 };
const WHOLE_WINDOW = { x: 0, y: 0, ...WINDOW };
const YEAR = new Date().getFullYear();

// Testing Library leaves a pane hidden from accessibility out of its queries by default.
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

// The pane an instance is rendered in.
const paneOf = (instance: Instance): string | null => {
  for (let node = instance.parent; node !== null; node = node.parent) {
    if (node.props.testID === COMPANION || node.props.testID === PRIMARY) {
      return node.props.testID;
    }
  }

  return null;
};

const styleOf = (rendered: Rendered, testID: string) =>
  StyleSheet.flatten(oneOf(rendered, testID).props.style);

const frameOf = (rendered: Rendered, testID: string) => {
  const { left, top, width, height } = styleOf(rendered, testID);

  return { x: left, y: top, width, height };
};

// A pane that is mounted and cannot be seen, touched or read out.
const isHidden = (rendered: Rendered, testID: string): boolean => {
  const { props } = oneOf(rendered, testID);

  return (
    styleOf(rendered, testID).opacity === 0 &&
    props.pointerEvents === 'none' &&
    props.accessibilityElementsHidden === true
  );
};

const isShared = (rendered: Rendered): boolean =>
  allOf(rendered, DIVIDER).length === 1 &&
  !isHidden(rendered, COMPANION) &&
  !isHidden(rendered, PRIMARY) &&
  frameOf(rendered, COMPANION).width < WINDOW.width &&
  frameOf(rendered, PRIMARY).width < WINDOW.width;

const isWholeWindow = (rendered: Rendered, testID: string, other: string): boolean =>
  frameOf(rendered, testID).width === WHOLE_WINDOW.width &&
  frameOf(rendered, testID).height === WHOLE_WINDOW.height &&
  !isHidden(rendered, testID) &&
  isHidden(rendered, other) &&
  allOf(rendered, DIVIDER).length === 0;

const pressTables = async (rendered: Rendered): Promise<void> => {
  await fireEvent.press(rendered.getByTestId(BUTTON));
};

const pickYear = async (rendered: Rendered, year: number): Promise<void> => {
  await fireEvent.press(rendered.getByTestId('tables-period'));
  await fireEvent.press(rendered.getByTestId(`tables-period-option-year-${year}`));
};

describe('Tables takes the whole window', () => {
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
    it('shares the window between Home and Statistics until Tables opens', async () => {
      const rendered = await renderRoot();

      expect(isShared(rendered)).toBe(true);
      expect(namesOf('HomeTab')).toEqual(['Home']);
    });

    it('gives the primary pane the whole window and hides the companion', async () => {
      const rendered = await renderRoot();

      await pressTables(rendered);

      expect(namesOf('HomeTab')).toEqual(['Home', 'Tables']);
      expect(isWholeWindow(rendered, PRIMARY, COMPANION)).toBe(true);
      expect(rendered.getByTestId('tables-period')).toBeTruthy();
    });

    it('opens Tables in the pane of Home, so Back is there', async () => {
      const rendered = await renderRoot();

      await pressTables(rendered);

      const home = stackOf('HomeTab');
      const tables = home.routes.find(({ name }) => name === 'Tables');

      expect(home.panes[tables?.key ?? '']).toBe('primary');
      expect(home.routes[0]?.name).toBe('Home');
    });

    it('keeps the Statistics beside Home mounted, with no route made for it', async () => {
      const rendered = await renderRoot();
      const before = oneOf(rendered, BUTTON);

      await pressTables(rendered);

      expect(namesOf('HomeTab')).not.toContain('Statistics');
      expect(allOf(rendered, BUTTON)).toHaveLength(1);
      expect(oneOf(rendered, BUTTON)).toBe(before);
      expect(paneOf(oneOf(rendered, BUTTON))).toBe(COMPANION);
      expect(paneOf(rendered.getByTestId('tables-period'))).toBe(PRIMARY);
    });

    it('shares the window again on Back, with the route state it had', async () => {
      const rendered = await renderRoot();
      const before = oneOf(rendered, BUTTON);

      await pressTables(rendered);
      await act(async () => {
        navigationRef.goBack();
      });

      expect(namesOf('HomeTab')).toEqual(['Home']);
      expect(isShared(rendered)).toBe(true);
      expect(oneOf(rendered, BUTTON)).toBe(before);
    });

    it('gives the companion the window when Tables opens over a Statistics route that is there', async () => {
      mockLayout.mode = 'single';
      const rendered = await renderRoot();

      await act(async () => {
        navigationRef.navigate('HomeTab', { screen: 'Statistics' });
      });
      await setLayout('columns');

      expect(namesOf('HomeTab')).toEqual(['Home', 'Statistics']);
      expect(isShared(rendered)).toBe(true);

      await pressTables(rendered);

      expect(namesOf('HomeTab')).toEqual(['Home', 'Statistics', 'Tables']);
      expect(isWholeWindow(rendered, COMPANION, PRIMARY)).toBe(true);
    });
  });

  describe('on the Statistics tab with two panes', () => {
    it('shares the window between Statistics and Home until Tables opens', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(isShared(rendered)).toBe(true);
    });

    it('gives the primary pane the whole window and hides the Home beside it', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await pressTables(rendered);

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(isWholeWindow(rendered, PRIMARY, COMPANION)).toBe(true);
    });

    it('keeps the Statistics under Tables in the same pane, mounted, with Back to it', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      const before = oneOf(rendered, BUTTON);

      await pressTables(rendered);

      expect(oneOf(rendered, BUTTON)).toBe(before);
      expect(paneOf(oneOf(rendered, BUTTON))).toBe(PRIMARY);
      expect(paneOf(rendered.getByTestId('tables-period'))).toBe(PRIMARY);

      await act(async () => {
        navigationRef.goBack();
      });

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(isShared(rendered)).toBe(true);
      expect(oneOf(rendered, BUTTON)).toBe(before);
    });

    it('closes a form that is over Statistics, and gives Tables the window', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await act(async () => {
        navigationRef.dispatch({
          type: 'PANE_OPEN',
          payload: { openerKey: 'pane-default:companion', route: { name: 'TransactionForm' } },
          target: stackOf('StatisticsTab').key,
        });
      });

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Home', 'TransactionForm']);
      expect(isShared(rendered)).toBe(true);
      expect(rendered.getByTestId('transaction-form-stub')).toBeTruthy();

      await pressTables(rendered);

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(isWholeWindow(rendered, PRIMARY, COMPANION)).toBe(true);
    });
  });

  describe('with one pane', () => {
    it('has no panes, and Tables is not capped at the pane max width on a regular window', async () => {
      mockLayout.mode = 'single';
      reportWindow('regular', 669, 951);
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await pressTables(rendered);

      let node = rendered.getByTestId('tables-period').parent;

      while (node !== null && node.props.testID !== 'screen-content') {
        node = node.parent;
      }

      expect(allOf(rendered, PRIMARY)).toHaveLength(0);
      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(node).not.toBeNull();
      expect(StyleSheet.flatten(node?.parent?.props.style).maxWidth).toBeUndefined();
      expect(darkTheme.layout.paneMaxWidth).toBeLessThan(669);
    });

    it('shows Home and Statistics as they were, with no panes', async () => {
      mockLayout.mode = 'single';
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      expect(allOf(rendered, PRIMARY)).toHaveLength(0);
      expect(allOf(rendered, COMPANION)).toHaveLength(0);
      expect(rendered.getByTestId(BUTTON)).toBeTruthy();
    });
  });

  describe('a fold and an unfold with Tables open', () => {
    it.each(['HomeTab', 'StatisticsTab'])(
      'keeps the year picked on the %s, and gives the window to Tables again',
      async (tab) => {
        const rendered = await renderRoot();

        await goToTab(tab);
        await pressTables(rendered);
        await pickYear(rendered, YEAR);

        await setLayout('single');

        expect(allOf(rendered, PRIMARY)).toHaveLength(0);
        expect(rendered.getByTestId('tables-period')).toHaveTextContent(String(YEAR), {
          exact: false,
        });

        await setLayout('columns');

        expect(isWholeWindow(rendered, PRIMARY, COMPANION)).toBe(true);
        expect(rendered.getByTestId('tables-period')).toHaveTextContent(String(YEAR), {
          exact: false,
        });
        expect(stackOf(tab).routes.at(-1)?.params?.period).toEqual({ kind: 'year', year: YEAR });
      },
    );
  });
});
