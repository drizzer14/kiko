import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { reportWindow } from '@kiko/test-support/window-size';
import { act, fireEvent } from '@testing-library/react-native';
import { spyOnModalDismissPerTest } from '@kiko/test-support/modal-dismiss-spy';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { answerFilterData, FILTER_DATA_CLOCK } from '@kiko/test-support/statistics-filter-data';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import {
  goToTab,
  navigationRef,
  pickThisQuarter,
  renderRoot,
  setLayout,
  THIS_QUARTER,
} from './__fixtures__/tables-navigator-world';
import { layout } from './__fixtures__/mock-layout';

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

jest.mock('@kiko/display-regions', () =>
  require('./__fixtures__/mock-layout').displayRegionsModule(),
);

jest.mock('@bottom-tabs/react-navigation', () =>
  require('./__fixtures__/mock-layout').bottomTabsModule(),
);

type StackRoute = {
  key: string;
  name: string;
  params?: { period?: { kind: string; year?: number }; transactionId?: string };
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

// Testing Library leaves a view hidden from accessibility out of its queries by default, and a
// shown layer is a modal view, which hides the panes beside it.
const WITH_HIDDEN = { includeHiddenElements: true } as const;

type Rendered = Awaited<ReturnType<typeof renderRoot>>;

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
    jest.useFakeTimers({ now: FILTER_DATA_CLOCK });
    layout.mode = 'columns';
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
      layout.mode = 'single';
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
      layout.mode = 'single';
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
      layout.mode = 'single';
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      expect(allOf(rendered, PRIMARY)).toHaveLength(0);
      expect(allOf(rendered, COMPANION)).toHaveLength(0);
      expect(allOf(rendered, LAYER)).toHaveLength(0);
      expect(rendered.getByTestId(BUTTON)).toBeTruthy();
    });
  });

  // A row of the list behind a cell opens its transaction's form from Tables, once the list has
  // closed. The world holds the spending `e1` (Groceries) and `e2` (Transport), so the Total cell
  // of Groceries lists `e1`.
  describe('a row of a cell opens its form', () => {
    const modal = spyOnModalDismissPerTest('cell-rows-sheet-modal');

    const formsOf = (tab: string): StackRoute[] =>
      stackOf(tab).routes.filter(({ name }) => name === 'TransactionForm');

    const openRow = async (rendered: Rendered): Promise<void> => {
      await act(async () => {
        await fireEvent.press(rendered.getByLabelText('Groceries, Total'));
      });

      await fireEvent.press(rendered.getByTestId('cell-row-e1'));
      await modal.finishClosing();
    };

    const openFormOf = async (transactionId: string): Promise<void> => {
      await act(async () => {
        navigationRef.dispatch({
          type: 'PANE_OPEN',
          payload: {
            openerKey: 'pane-default:companion',
            route: { name: 'TransactionForm', params: { transactionId } },
          },
          target: stackOf('StatisticsTab').key,
        });
      });
    };

    it('opens the form over Tables in the layer, and Back shows Tables, then the panes as they were', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');

      const before = framesOf(rendered);

      await pressTables(rendered);
      await openRow(rendered);

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables', 'TransactionForm']);
      expect(formsOf('StatisticsTab')[0].params).toEqual({ transactionId: 'e1' });
      expect(placeOf(oneOf(rendered, FORM))).toBe(LAYER);
      expect(framesOf(rendered)).toEqual(before);
      expect(isLayerOpen(rendered)).toBe(true);

      await goBack();

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);

      await goBack();

      expect(namesOf('StatisticsTab')).toEqual(['Statistics']);
      expect(framesOf(rendered)).toEqual(before);
      expect(isLayerAtRest(rendered)).toBe(true);
    });

    it('goes back to Tables when the native stack reports the dismissal of the form', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await pressTables(rendered);
      await openRow(rendered);
      await dismissNatively(oneOf(rendered, FORM));

      expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Tables']);
      expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
    });

    // The Duo unfolded, on the Statistics tab: the only pose where a form of the same transaction
    // can be open under Tables (Home's tap replaces its detail stack, and Tables opens from the
    // Statistics screen only). A second form would hold the old values under the edited one.
    describe('when the form of that transaction is already open under Tables', () => {
      it('shows that form as it was, closes Tables, and opens no second form', async () => {
        const rendered = await renderRoot();

        await goToTab('StatisticsTab');
        await openFormOf('e1');

        const form = oneOf(rendered, FORM);
        const [formRoute] = formsOf('StatisticsTab');

        await pressTables(rendered);
        await openRow(rendered);

        expect(formsOf('StatisticsTab')).toEqual([formRoute]);
        expect(namesOf('StatisticsTab')).toEqual(['Statistics', 'Home', 'TransactionForm']);
        expect(oneOf(rendered, FORM)).toBe(form);
        expect(placeOf(form)).toBe(COMPANION);
        expect(allOf(rendered, TABLES)).toHaveLength(0);
        expect(isLayerAtRest(rendered)).toBe(true);
      });

      // A form opened from that form (a template or a create form) is above it. Back from Tables
      // shows that one, the top route, and the form of the row is below it: still one form of it,
      // none written over by a stale second.
      it('shows the route above it when one is open there, and still opens no second form', async () => {
        const rendered = await renderRoot();

        await goToTab('StatisticsTab');
        await openFormOf('e1');
        await act(async () => {
          navigationRef.dispatch({
            type: 'PUSH',
            payload: { name: 'TransactionForm', params: { templateId: 'template' } },
            target: stackOf('StatisticsTab').key,
          });
        });
        await pressTables(rendered);
        await openRow(rendered);

        expect(namesOf('StatisticsTab')).toEqual([
          'Statistics',
          'Home',
          'TransactionForm',
          'TransactionForm',
        ]);
        expect(formsOf('StatisticsTab').map(({ params }) => params)).toEqual([
          { transactionId: 'e1' },
          { templateId: 'template' },
        ]);
        expect(allOf(rendered, TABLES)).toHaveLength(0);
        expect(isLayerAtRest(rendered)).toBe(true);
      });
    });
  });

  // This row passes on any code that keeps the route in the state: it says the period survives the
  // switch and the layer is there again, nothing about how a Back behaves after the cycle on a
  // device.
  describe('a fold and an unfold with Tables open', () => {
    it.each(['HomeTab', 'StatisticsTab'])(
      'keeps the period picked on the %s, and shows Tables in the layer again',
      async (tab) => {
        const rendered = await renderRoot();

        await goToTab(tab);
        await pressTables(rendered);
        await pickThisQuarter(rendered);

        await setLayout('single');

        expect(allOf(rendered, PRIMARY)).toHaveLength(0);
        expect(allOf(rendered, LAYER)).toHaveLength(0);
        expect(rendered.getByTestId(TABLES)).toHaveTextContent('This quarter', {
          exact: false,
        });

        await setLayout('columns');

        expect(placeOf(oneOf(rendered, TABLES))).toBe(LAYER);
        expect(isLayerOpen(rendered)).toBe(true);
        expect(allOf(rendered, DIVIDER)).toHaveLength(1);
        expect(rendered.getByTestId(TABLES)).toHaveTextContent('This quarter', {
          exact: false,
        });
        expect(stackOf(tab).routes.at(-1)?.params?.period).toEqual(THIS_QUARTER);

        await goBack();

        expect(isLayerAtRest(rendered)).toBe(true);
        expect(allOf(rendered, TABLES)).toHaveLength(0);
      },
    );
  });
});
