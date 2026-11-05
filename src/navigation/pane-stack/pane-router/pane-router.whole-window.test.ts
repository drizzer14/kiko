import { CommonActions, StackActions } from '@react-navigation/native';

import { PaneActions, PaneRouter, type PaneRouterAction, type PaneStackState } from '.';

const CONFIG = {
  routeNames: ['Home', 'Statistics', 'Tables', 'TransactionForm'],
  routeParamList: {},
  routeGetIdList: {},
};

const homeRouter = PaneRouter({
  paneConfig: {
    rootPane: 'primary',
    companionDefault: { name: 'Statistics', isDefault: true },
    wholeWindowRoutes: ['Tables'],
  },
  isSplit: () => true,
});

const statisticsRouter = PaneRouter({
  paneConfig: {
    rootPane: 'primary',
    companionDefault: { name: 'Home', isDefault: true },
    wholeWindowRoutes: ['Tables'],
  },
  isSplit: () => true,
});

const runWith =
  (subject: ReturnType<typeof PaneRouter>) =>
  (state: PaneStackState, action: PaneRouterAction): PaneStackState => {
    const next = subject.getStateForAction(state, action, CONFIG);

    if (next === null) {
      throw new Error(`action ${action.type} was not handled`);
    }

    return next as PaneStackState;
  };

const runHome = runWith(homeRouter);
const runStatistics = runWith(statisticsRouter);

const names = (state: PaneStackState) => state.routes.map((route) => route.name);
const keyOf = (state: PaneStackState, name: string) =>
  state.routes.find((route) => route.name === name)?.key ?? '';

const STATIC_COMPANION = 'pane-default:companion';

describe('PaneRouter and a whole-window route', () => {
  describe('PANE_OPEN from the static default beside Home', () => {
    const home = homeRouter.getInitialState(CONFIG);

    it('opens Tables above Home and does not make the default a real route', () => {
      const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));

      expect(names(opened)).toEqual(['Home', 'Tables']);
      expect(opened.panes).toEqual({
        [keyOf(opened, 'Home')]: 'primary',
        [keyOf(opened, 'Tables')]: 'companion',
      });
      expect(opened.index).toBe(1);
    });

    it('still makes the default a real route for a route that is not listed', () => {
      const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'TransactionForm'));

      expect(names(opened)).toEqual(['Home', 'Statistics', 'TransactionForm']);
      expect(opened.panes[keyOf(opened, 'TransactionForm')]).toBe('companion');
    });
  });

  it('opens Tables above the Statistics root, which keeps the root pane', () => {
    const statistics = statisticsRouter.getInitialState({
      ...CONFIG,
      routeNames: ['Statistics', 'Tables', 'Home', 'TransactionForm'],
    });
    const opened = runStatistics(statistics, PaneActions.open(statistics.routes[0].key, 'Tables'));

    expect(names(opened)).toEqual(['Statistics', 'Tables']);
    expect(opened.panes[keyOf(opened, 'Statistics')]).toBe('primary');
  });

  it('opens Tables above a real Statistics that sits in the companion pane, which keeps it', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const withStatistics = runHome(home, PaneActions.open(home.routes[0].key, 'Statistics'));
    const opened = runHome(
      withStatistics,
      PaneActions.open(keyOf(withStatistics, 'Statistics'), 'Tables'),
    );

    expect(names(opened)).toEqual(['Home', 'Statistics', 'Tables']);
    expect(opened.panes[keyOf(opened, 'Statistics')]).toBe('companion');
  });

  // The user's ruling "A: It stays (Recommended)": the form stays open under Tables, and Back
  // returns to it, the same route with the same key, so its draft is kept.
  describe('Tables over a form that is open', () => {
    const statistics = statisticsRouter.getInitialState({
      ...CONFIG,
      routeNames: ['Statistics', 'Tables', 'Home', 'TransactionForm'],
    });
    const withForm = runStatistics(
      statistics,
      PaneActions.open(STATIC_COMPANION, 'TransactionForm'),
    );

    it('keeps the form when Tables opens from Statistics', () => {
      const opened = runStatistics(withForm, PaneActions.open(statistics.routes[0].key, 'Tables'));

      expect(names(withForm)).toEqual(['Statistics', 'Home', 'TransactionForm']);
      expect(names(opened)).toEqual(['Statistics', 'Home', 'TransactionForm', 'Tables']);
      expect(opened.routes.slice(0, 3)).toEqual(withForm.routes);
    });

    it('goes back to the form as it was, in the same pane', () => {
      const opened = runStatistics(withForm, PaneActions.open(statistics.routes[0].key, 'Tables'));
      const back = runStatistics(opened, CommonActions.goBack());

      expect(back.routes).toEqual(withForm.routes);
      expect(back.panes).toEqual(withForm.panes);
    });
  });

  it('goes back from Tables to Home, so the panes keep the routes they had', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));
    const back = runHome(opened, CommonActions.goBack());

    expect(names(back)).toEqual(['Home']);
    expect(back.panes).toEqual({ [keyOf(back, 'Home')]: 'primary' });
  });

  // The native Back closes Tables by a POP that names the screen it comes from: the router takes it
  // as the stack router's own pop, for the top route, and never as a bystander's.
  it('goes back by the POP of the screen on top, as the native Back sends it', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));
    const back = runHome(opened, {
      ...StackActions.pop(1),
      source: keyOf(opened, 'Tables'),
      target: opened.key,
    });

    expect(names(back)).toEqual(['Home']);
    expect(back.panes).toEqual({ [keyOf(back, 'Home')]: 'primary' });
  });

  // A native dismiss of two screens comes from the layer's root and Tables together. Its Tables is
  // the layer's first screen, so no floor of one screen is kept, or the Back would do nothing.
  describe('a native dismiss of two screens from Tables', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));

    it('closes Tables and nothing else', () => {
      const dismissed = runHome(opened, {
        ...StackActions.pop(2),
        source: keyOf(opened, 'Tables'),
        target: opened.key,
      });

      expect(names(dismissed)).toEqual(['Home']);
    });

    it('closes both screens of a layer of two, and leaves the pane routes alone', () => {
      const withForm = runHome(
        opened,
        PaneActions.open(keyOf(opened, 'Tables'), 'TransactionForm'),
      );
      const dismissed = runHome(withForm, {
        ...StackActions.pop(2),
        source: keyOf(withForm, 'TransactionForm'),
        target: withForm.key,
      });

      expect(names(withForm)).toEqual(['Home', 'Tables', 'TransactionForm']);
      expect(names(dismissed)).toEqual(['Home']);
    });
  });

  it('keeps Tables on top through a fold and an unfold', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));
    const unfolded = runHome(runHome(opened, PaneActions.fold()), PaneActions.unfold());

    expect(names(unfolded)).toEqual(['Home', 'Tables']);
    expect(unfolded.routes).toEqual(opened.routes);
  });
});
