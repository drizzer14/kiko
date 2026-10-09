import { CommonActions, StackActions } from '@react-navigation/native';

import { PaneActions, PaneRouter, type PaneRouterAction, type PaneStackState } from '.';

const ROUTE_NAMES = ['Accounts', 'AccountDetail', 'HoldingForm', 'Statement'];
const CONFIG = { routeNames: ROUTE_NAMES, routeParamList: {}, routeGetIdList: {} };

const router = PaneRouter({ paneConfig: { rootPane: 'companion' } });
const homeRouter = PaneRouter({
  paneConfig: {
    rootPane: 'primary',
    companionDefault: { name: 'Statement', isDefault: true },
  },
});

const initial = (): PaneStackState => router.getInitialState(CONFIG);

const runWith =
  (subject: ReturnType<typeof PaneRouter>) =>
  (state: PaneStackState, action: PaneRouterAction): PaneStackState => {
    const next = subject.getStateForAction(state, action, CONFIG);

    if (next === null) {
      throw new Error(`action ${action.type} was not handled`);
    }

    return next as PaneStackState;
  };

const run = runWith(router);
const runHome = runWith(homeRouter);

const names = (state: PaneStackState) => state.routes.map((route) => route.name);
const keyOf = (state: PaneStackState, name: string) =>
  state.routes.find((route) => route.name === name)?.key ?? '';

const withDetail = (): PaneStackState => {
  const state = initial();

  return run(state, PaneActions.open(state.routes[0].key, 'AccountDetail', { accountId: 'a' }));
};

describe('PaneRouter', () => {
  it('starts with a stack router state and no stored panes', () => {
    const state = initial();

    expect(state.type).toBe('stack');
    expect(names(state)).toEqual(['Accounts']);
    expect(state.panes).toEqual({});
  });

  describe('PANE_OPEN', () => {
    it('pushes the route into the pane opposite to the opener and stores both panes', () => {
      const state = withDetail();

      expect(names(state)).toEqual(['Accounts', 'AccountDetail']);
      expect(state.index).toBe(1);
      expect(state.routes[1].params).toEqual({ accountId: 'a' });
      expect(state.panes).toEqual({
        [keyOf(state, 'Accounts')]: 'companion',
        [keyOf(state, 'AccountDetail')]: 'primary',
      });
    });

    it('replaces the first detail when the list opens a second one', () => {
      const first = withDetail();
      const second = run(
        first,
        PaneActions.open(keyOf(first, 'Accounts'), 'AccountDetail', { accountId: 'b' }),
      );

      expect(names(second)).toEqual(['Accounts', 'AccountDetail']);
      expect(second.routes[1].params).toEqual({ accountId: 'b' });
      expect(Object.keys(second.panes)).toHaveLength(2);
      expect(second.panes[first.routes[1].key]).toBeUndefined();
    });

    it('opens from the detail into the companion without closing the list', () => {
      const detail = withDetail();
      const form = run(detail, PaneActions.open(keyOf(detail, 'AccountDetail'), 'HoldingForm'));

      expect(names(form)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
      expect(form.panes[keyOf(form, 'HoldingForm')]).toBe('companion');
    });

    it('opens from a default that stands in the stack, and makes it a real route', () => {
      const shown = run(
        initial(),
        PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'first' }),
      );
      const form = run(shown, PaneActions.open(keyOf(shown, 'AccountDetail'), 'HoldingForm'));

      expect(shown.routes[1].isDefault).toBe(true);
      expect(form.routes.map((route) => route.isDefault)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('leads Back from the form opened on a default to that now-real page, after a fold', () => {
      const shown = run(
        initial(),
        PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'first' }),
      );
      const form = run(shown, PaneActions.open(keyOf(shown, 'AccountDetail'), 'HoldingForm'));
      const folded = run(form, PaneActions.fold());
      const back = run(folded, CommonActions.goBack());

      expect(names(folded)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
      expect(names(back)).toEqual(['Accounts', 'AccountDetail']);
      expect(back.routes[1].params).toEqual({ accountId: 'first' });
    });

    it('opens from a static default, which stands right above the root', () => {
      const opened = runHome(
        homeRouter.getInitialState(CONFIG),
        PaneActions.open('pane-default:companion', 'HoldingForm'),
      );

      expect(names(opened)).toEqual(['Accounts', 'HoldingForm']);
      expect(opened.panes[opened.routes[1].key]).toBe('primary');
    });

    it('is not handled when the opener is unknown', () => {
      expect(
        router.getStateForAction(initial(), PaneActions.open('missing', 'HoldingForm'), CONFIG),
      ).toBeNull();
    });

    it('is not handled for a route the navigator does not have', () => {
      const state = initial();

      expect(
        router.getStateForAction(state, PaneActions.open(state.routes[0].key, 'Nowhere'), CONFIG),
      ).toBeNull();
    });
  });

  describe('PANE_FOLD and PANE_UNFOLD', () => {
    it('drops the default routes and keeps the pane of every tapped route', () => {
      const detail = withDetail();
      const shown = run(detail, PaneActions.showDefault('companion', 'Statement'));
      const folded = run(shown, PaneActions.fold());

      expect(names(folded)).toEqual(['Accounts', 'AccountDetail']);
      expect(folded.index).toBe(1);
      expect(folded.panes).toEqual(detail.panes);
    });

    it('leaves a state with no default routes as it is', () => {
      const detail = withDetail();

      expect(run(detail, PaneActions.fold())).toBe(detail);
    });

    it('stores a pane for every route on unfold, alternating from the root pane', () => {
      const state = initial();
      const pushed = run(
        run(state, StackActions.push('AccountDetail')),
        StackActions.push('HoldingForm'),
      );
      const unfolded = run(pushed, PaneActions.unfold());

      expect(unfolded.panes).toEqual({
        [pushed.routes[0].key]: 'companion',
        [pushed.routes[1].key]: 'primary',
        [pushed.routes[2].key]: 'companion',
      });
      expect(run(unfolded, PaneActions.unfold())).toBe(unfolded);
    });

    it('keeps the pane of a route opened unfolded through a fold and an unfold', () => {
      const detail = withDetail();
      const form = run(detail, PaneActions.open(keyOf(detail, 'AccountDetail'), 'HoldingForm'));
      const roundTrip = run(run(form, PaneActions.fold()), PaneActions.unfold());

      expect(roundTrip.panes).toEqual(form.panes);
    });
  });

  describe('PANE_SHOW_DEFAULT', () => {
    it('stands the default right above the root, in its pane', () => {
      const root = homeRouter.getInitialState(CONFIG);
      const tapped = runHome(root, PaneActions.open('pane-default:companion', 'HoldingForm'));
      const shown = runHome(tapped, PaneActions.showDefault('companion', 'Statement'));

      expect(names(shown)).toEqual(['Accounts', 'Statement', 'HoldingForm']);
      expect(shown.index).toBe(2);
      expect(shown.routes[1].isDefault).toBe(true);
      expect(shown.panes[shown.routes[1].key]).toBe('companion');
      expect(shown.panes[shown.routes[2].key]).toBe('primary');
    });

    it('replaces the default the pane already shows', () => {
      const first = run(
        initial(),
        PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'a' }),
      );
      const second = run(
        first,
        PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'b' }),
      );

      expect(names(second)).toEqual(['Accounts', 'AccountDetail']);
      expect(second.routes[1].params).toEqual({ accountId: 'b' });
      expect(Object.keys(second.panes)).toHaveLength(2);
    });

    it('leaves a pane alone when the user already tapped a route there', () => {
      const detail = withDetail();

      expect(run(detail, PaneActions.showDefault('primary', 'Statement'))).toBe(detail);
    });

    it('is not handled for a route the navigator does not have', () => {
      expect(
        router.getStateForAction(initial(), PaneActions.showDefault('primary', 'Nowhere'), CONFIG),
      ).toBeNull();
    });
  });

  describe('standard actions', () => {
    it('removes the pane of a route that goes back', () => {
      const detail = withDetail();
      const back = run(detail, CommonActions.goBack());

      expect(names(back)).toEqual(['Accounts']);
      expect(back.panes).toEqual({ [keyOf(back, 'Accounts')]: 'companion' });
    });

    it('removes the panes of every route that a pop to top closes', () => {
      const detail = withDetail();
      const form = run(detail, PaneActions.open(keyOf(detail, 'AccountDetail'), 'HoldingForm'));
      const popped = run(form, StackActions.popToTop());

      expect(names(popped)).toEqual(['Accounts']);
      expect(Object.keys(popped.panes)).toEqual([keyOf(popped, 'Accounts')]);
    });

    it('leaves a plain push without a stored pane, so it takes the pane opposite the route below', () => {
      const pushed = run(initial(), StackActions.push('AccountDetail'));

      expect(pushed.panes).toEqual({});
    });

    it('lets a replacing route take the pane of the route it replaces', () => {
      const detail = withDetail();
      const replaced = run(detail, StackActions.replace('HoldingForm'));

      expect(names(replaced)).toEqual(['Accounts', 'HoldingForm']);
      expect(replaced.panes[keyOf(replaced, 'HoldingForm')]).toBe('primary');
      expect(replaced.panes[keyOf(detail, 'AccountDetail')]).toBeUndefined();
    });

    it('does not handle an action the stack router does not handle', () => {
      expect(router.getStateForAction(initial(), CommonActions.goBack(), CONFIG)).toBeNull();
    });
  });

  describe('rehydration', () => {
    it('restores the stored panes of the routes that remain', () => {
      const detail = withDetail();
      const rehydrated = router.getRehydratedState(
        {
          routes: [
            { key: keyOf(detail, 'Accounts'), name: 'Accounts' },
            { key: keyOf(detail, 'AccountDetail'), name: 'AccountDetail' },
          ],
          panes: { ...detail.panes, gone: 'primary' },
        } as never,
        CONFIG,
      );

      expect(rehydrated.panes).toEqual(detail.panes);
    });

    it('rehydrates a state with no pane map to an empty one', () => {
      const rehydrated = router.getRehydratedState(
        { routes: [{ name: 'Accounts' }, { name: 'AccountDetail' }] },
        CONFIG,
      );

      expect(rehydrated.panes).toEqual({});
      expect(rehydrated.index).toBe(1);
    });

    it('returns an already rehydrated state as it is', () => {
      const state = withDetail();

      expect(router.getRehydratedState(state, CONFIG)).toBe(state);
    });
  });

  describe('route changes', () => {
    it('drops the panes of routes that a route-name change removes', () => {
      const detail = withDetail();
      const changed = router.getStateForRouteNamesChange(detail, {
        ...CONFIG,
        routeNames: ['Accounts', 'HoldingForm'],
        routeKeyChanges: [],
      });

      expect(names(changed)).toEqual(['Accounts']);
      expect(Object.keys(changed.panes)).toEqual([keyOf(detail, 'Accounts')]);
    });

    it('drops the panes of routes above a focused route', () => {
      const detail = withDetail();
      const focused = router.getStateForRouteFocus(detail, keyOf(detail, 'Accounts'));

      expect(names(focused)).toEqual(['Accounts']);
      expect(Object.keys(focused.panes)).toEqual([keyOf(detail, 'Accounts')]);
    });
  });
});
