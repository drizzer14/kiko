import { CommonActions } from '@react-navigation/native';

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

    it('opens Tables in Home’s pane and does not make the default a real route', () => {
      const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));

      expect(names(opened)).toEqual(['Home', 'Tables']);
      expect(opened.panes).toEqual({
        [keyOf(opened, 'Home')]: 'primary',
        [keyOf(opened, 'Tables')]: 'primary',
      });
      expect(opened.index).toBe(1);
    });

    it('still makes the default a real route for a route that is not listed', () => {
      const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'TransactionForm'));

      expect(names(opened)).toEqual(['Home', 'Statistics', 'TransactionForm']);
      expect(opened.panes[keyOf(opened, 'TransactionForm')]).toBe('companion');
    });
  });

  it('opens Tables above the Statistics root in the root’s pane', () => {
    const statistics = statisticsRouter.getInitialState({
      ...CONFIG,
      routeNames: ['Statistics', 'Tables', 'Home', 'TransactionForm'],
    });
    const opened = runStatistics(statistics, PaneActions.open(statistics.routes[0].key, 'Tables'));

    expect(names(opened)).toEqual(['Statistics', 'Tables']);
    expect(opened.panes[keyOf(opened, 'Tables')]).toBe('primary');
  });

  it('opens Tables above a real Statistics that sits in the companion pane, in that pane', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const withStatistics = runHome(home, PaneActions.open(STATIC_COMPANION, 'Statistics'));
    const opened = runHome(
      withStatistics,
      PaneActions.open(keyOf(withStatistics, 'Statistics'), 'Tables'),
    );

    expect(names(opened)).toEqual(['Home', 'Statistics', 'Tables']);
    expect(opened.panes[keyOf(opened, 'Tables')]).toBe('companion');
  });

  it('goes back from Tables to Home, so the pane keeps the route to go back to', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));
    const back = runHome(opened, CommonActions.goBack());

    expect(names(back)).toEqual(['Home']);
    expect(back.panes).toEqual({ [keyOf(back, 'Home')]: 'primary' });
  });

  it('keeps Tables in its pane through a fold and an unfold', () => {
    const home = homeRouter.getInitialState(CONFIG);
    const opened = runHome(home, PaneActions.open(STATIC_COMPANION, 'Tables'));
    const unfolded = runHome(runHome(opened, PaneActions.fold()), PaneActions.unfold());

    expect(names(unfolded)).toEqual(['Home', 'Tables']);
    expect(unfolded.panes[keyOf(unfolded, 'Tables')]).toBe('primary');
  });
});
