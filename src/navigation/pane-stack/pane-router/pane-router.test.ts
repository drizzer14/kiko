import { CommonActions, StackActions } from '@react-navigation/native';

import { routesOfPane } from '../pane-assignment';

import { PaneActions, PaneRouter, type PaneRouterAction, type PaneStackState } from '.';

const ROUTE_NAMES = [
  'Accounts',
  'AccountDetail',
  'HoldingForm',
  'Statement',
  'Home',
  'TransactionForm',
  'Settings',
  'System',
  'Reminders',
  'ReminderForm',
];
const CONFIG = { routeNames: ROUTE_NAMES, routeParamList: {}, routeGetIdList: {} };

const SPLIT = () => true;
const SINGLE = () => false;

const router = PaneRouter({ paneConfig: { rootPane: 'companion' }, isSplit: SPLIT });
const homeRouter = PaneRouter({
  paneConfig: {
    rootPane: 'primary',
    companionDefault: { name: 'Statement', isDefault: true },
  },
  isSplit: SPLIT,
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

    // One pane has no second pane to fill, and a default left in its stack would be a screen the
    // user never opened, on top of the one they did.
    it('leaves the stack as it is while the navigator shows one pane', () => {
      const single = PaneRouter({ paneConfig: { rootPane: 'companion' }, isSplit: SINGLE });
      const state = single.getInitialState(CONFIG);

      expect(runWith(single)(state, PaneActions.showDefault('primary', 'AccountDetail'))).toBe(
        state,
      );
    });
  });

  describe('PANE_CLOSE', () => {
    it('closes the route named and leaves every other route in its pane', () => {
      const detail = withDetail();
      const form = run(detail, PaneActions.open(keyOf(detail, 'AccountDetail'), 'HoldingForm'));
      const closed = run(form, PaneActions.close(keyOf(form, 'AccountDetail')));

      expect(names(closed)).toEqual(['Accounts', 'HoldingForm']);
      expect(closed.panes).toEqual({
        [keyOf(closed, 'Accounts')]: 'companion',
        [keyOf(closed, 'HoldingForm')]: 'companion',
      });
      expect(closed.index).toBe(1);
    });

    it('closes the route on top too', () => {
      const detail = withDetail();
      const closed = run(detail, PaneActions.close(keyOf(detail, 'AccountDetail')));

      expect(names(closed)).toEqual(['Accounts']);
      expect(closed.panes).toEqual({ [keyOf(closed, 'Accounts')]: 'companion' });
    });

    it('does nothing for a route that is already gone, rather than closing another one', () => {
      const detail = withDetail();

      expect(run(detail, PaneActions.close('a-route-that-closed'))).toBe(detail);
    });

    it('is not handled for the root, which the stack never closes', () => {
      const detail = withDetail();

      expect(
        router.getStateForAction(detail, PaneActions.close(keyOf(detail, 'Accounts')), CONFIG),
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

  describe('an action from a route under the focused one', () => {
    const settingsConfig = {
      rootPane: 'companion',
      primaryDefault: { name: 'Statement', isDefault: true },
    } as const;
    const settingsRouter = PaneRouter({
      paneConfig: settingsConfig,
      initialRouteName: 'Settings',
      isSplit: SPLIT,
    });
    const homeOnlyRouter = PaneRouter({
      paneConfig: { rootPane: 'primary', companionDefault: { name: 'Statement', isDefault: true } },
      initialRouteName: 'Home',
      isSplit: SPLIT,
    });
    const runSettings = runWith(settingsRouter);
    const runHomeOnly = runWith(homeOnlyRouter);

    const from = <Action extends PaneRouterAction>(source: string, action: Action): Action => ({
      ...action,
      source,
    });
    const paneNames = (
      state: PaneStackState,
      pane: 'companion' | 'primary',
      rootPane: 'companion' | 'primary' = 'companion',
    ) => routesOfPane(state.routes, state.panes, { rootPane }, pane).map((route) => route.name);

    // [Accounts, AccountDetail, HoldingForm, ReminderForm] with the form pushed by the form that
    // is focused: no pane is stored for the last two.
    const accountsWithTwoForms = (): PaneStackState => {
      const list = initial();
      const detail = run(
        list,
        from(
          list.routes[0].key,
          PaneActions.open(list.routes[0].key, 'AccountDetail', { accountId: 'a' }),
        ),
      );
      const holding = run(
        detail,
        from(keyOf(detail, 'AccountDetail'), StackActions.push('HoldingForm')),
      );

      return run(holding, from(keyOf(holding, 'HoldingForm'), StackActions.push('ReminderForm')));
    };

    it('opens the route beside the caller instead of changing the params of the focused route', () => {
      const root = homeOnlyRouter.getInitialState(CONFIG);
      const rowA = runHomeOnly(
        root,
        from(root.routes[0].key, CommonActions.navigate('TransactionForm', { transactionId: 'a' })),
      );
      const rowB = runHomeOnly(
        rowA,
        from(root.routes[0].key, CommonActions.navigate('TransactionForm', { transactionId: 'b' })),
      );

      expect(names(rowB)).toEqual(['Home', 'TransactionForm']);
      expect(rowB.routes[1].params).toEqual({ transactionId: 'b' });
      expect(rowB.routes[1].key).not.toBe(rowA.routes[1].key);
      expect(rowB.index).toBe(1);
      expect(paneNames(rowB, 'companion', 'primary')).toEqual(['TransactionForm']);
      expect(paneNames(rowB, 'primary', 'primary')).toEqual(['Home']);
    });

    it('opens a second reminder in place of the first, beside the list', () => {
      const menu = settingsRouter.getInitialState(CONFIG);
      const reminders = runSettings(menu, from(menu.routes[0].key, StackActions.push('Reminders')));
      const first = runSettings(
        reminders,
        from(keyOf(reminders, 'Reminders'), StackActions.push('ReminderForm', { id: '1' })),
      );
      const second = runSettings(
        first,
        from(keyOf(first, 'Reminders'), StackActions.push('ReminderForm', { id: '2' })),
      );

      expect(names(second)).toEqual(['Settings', 'Reminders', 'ReminderForm']);
      expect(second.routes[2].params).toEqual({ id: '2' });
      expect(second.routes[2].key).not.toBe(first.routes[2].key);
      expect(paneNames(second, 'companion')).toEqual(['Settings', 'ReminderForm']);
      expect(paneNames(second, 'primary')).toEqual(['Reminders']);
    });

    it('opens what the Settings menu taps in the pane of the screen it replaces', () => {
      const menu = settingsRouter.getInitialState(CONFIG);
      const system = runSettings(menu, from(menu.routes[0].key, StackActions.push('System')));
      const reminders = runSettings(
        system,
        from(menu.routes[0].key, CommonActions.navigate('Reminders')),
      );

      expect(names(reminders)).toEqual(['Settings', 'Reminders']);
      expect(paneNames(reminders, 'primary')).toEqual(['Reminders']);
      expect(paneNames(reminders, 'companion')).toEqual(['Settings']);
      expect(reminders.index).toBe(1);
    });

    it('is not handled when the route to open is not one of the navigator’s', () => {
      const state = accountsWithTwoForms();

      expect(
        router.getStateForAction(
          state,
          from(state.routes[0].key, CommonActions.navigate('Nowhere')),
          CONFIG,
        ),
      ).toBeNull();
    });

    it('pops the caller, not the top route, on go back', () => {
      const state = accountsWithTwoForms();
      const back = run(state, from(keyOf(state, 'HoldingForm'), CommonActions.goBack()));

      expect(names(back)).toEqual(['Accounts', 'AccountDetail', 'ReminderForm']);
      expect(back.index).toBe(2);
    });

    it('keeps the pane of every route that stays when a route in the middle closes', () => {
      const state = accountsWithTwoForms();
      const back = run(state, from(keyOf(state, 'HoldingForm'), CommonActions.goBack()));

      expect(paneNames(state, 'primary')).toEqual(['AccountDetail', 'ReminderForm']);
      expect(paneNames(back, 'primary')).toEqual(['AccountDetail', 'ReminderForm']);
      expect(paneNames(back, 'companion')).toEqual(['Accounts']);
    });

    it('pops the caller on pop', () => {
      const state = accountsWithTwoForms();
      const popped = run(state, from(keyOf(state, 'HoldingForm'), StackActions.pop()));

      expect(names(popped)).toEqual(['Accounts', 'AccountDetail', 'ReminderForm']);
    });

    it('pops to a route below the caller on pop to', () => {
      const state = accountsWithTwoForms();
      const popped = run(state, from(keyOf(state, 'HoldingForm'), StackActions.popTo('Accounts')));

      expect(names(popped)).toEqual(['Accounts']);
    });

    it('replaces the caller, in its own pane, not the top route', () => {
      const state = accountsWithTwoForms();
      const replaced = run(
        state,
        from(keyOf(state, 'HoldingForm'), StackActions.replace('Statement')),
      );

      expect(names(replaced)).toEqual(['Accounts', 'AccountDetail', 'Statement', 'ReminderForm']);
      expect(paneNames(replaced, 'companion')).toEqual(['Accounts', 'Statement']);
      expect(paneNames(replaced, 'primary')).toEqual(['AccountDetail', 'ReminderForm']);
    });

    // [Accounts(c), AccountDetail(p), HoldingForm(c), ReminderForm(p), Statement(c)]
    const fiveRoutes = (): PaneStackState => {
      const list = initial();
      const detail = run(list, PaneActions.open(list.routes[0].key, 'AccountDetail'));
      const holding = run(detail, PaneActions.open(keyOf(detail, 'AccountDetail'), 'HoldingForm'));
      const reminder = run(
        holding,
        PaneActions.open(keyOf(holding, 'HoldingForm'), 'ReminderForm'),
      );

      return run(reminder, PaneActions.open(keyOf(reminder, 'ReminderForm'), 'Statement'));
    };

    it('closes the routes of the dismissed pane, not the ones beneath it in the stack, on a native back of several', () => {
      const state = fiveRoutes();
      const dismissed = run(state, from(keyOf(state, 'Statement'), StackActions.pop(2)));

      expect(names(dismissed)).toEqual(['Accounts', 'AccountDetail', 'ReminderForm']);
      expect(paneNames(dismissed, 'companion')).toEqual(['Accounts']);
      expect(paneNames(dismissed, 'primary')).toEqual(['AccountDetail', 'ReminderForm']);
      expect(dismissed.index).toBe(2);
    });

    it('never closes the first route of the pane', () => {
      const state = fiveRoutes();
      const dismissed = run(state, from(keyOf(state, 'Statement'), StackActions.pop(9)));

      expect(names(dismissed)).toEqual(['Accounts', 'AccountDetail', 'ReminderForm']);
    });

    it('closes the routes of the pane of a route that is not the focused one', () => {
      const state = fiveRoutes();
      const dismissed = run(state, from(keyOf(state, 'ReminderForm'), StackActions.pop(2)));

      expect(names(dismissed)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm', 'Statement']);
    });

    it('closes the routes in stack order while the navigator shows one pane', () => {
      const single = PaneRouter({ paneConfig: { rootPane: 'companion' }, isSplit: SINGLE });
      const state = [
        'AccountDetail',
        'HoldingForm',
        'ReminderForm',
        'Statement',
      ].reduce<PaneStackState>(
        (stack, name) => runWith(single)(stack, StackActions.push(name)),
        single.getInitialState(CONFIG),
      );
      const dismissed = runWith(single)(
        state,
        from(keyOf(state, 'Statement'), StackActions.pop(2)),
      );

      expect(names(dismissed)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
    });

    it('leaves pop to top to the stack router, which closes everything above the root', () => {
      const state = accountsWithTwoForms();
      const popped = run(state, from(keyOf(state, 'HoldingForm'), StackActions.popToTop()));

      expect(names(popped)).toEqual(['Accounts']);
    });

    it('does not handle a go back from the root route', () => {
      const state = accountsWithTwoForms();

      expect(
        router.getStateForAction(state, from(state.routes[0].key, CommonActions.goBack()), CONFIG),
      ).toBeNull();
    });

    it('leaves an action from the focused route to the stack router', () => {
      const state = accountsWithTwoForms();
      const back = run(state, from(keyOf(state, 'ReminderForm'), CommonActions.goBack()));
      const pushed = run(state, from(keyOf(state, 'ReminderForm'), StackActions.push('Statement')));

      expect(names(back)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
      expect(names(pushed)).toEqual([
        'Accounts',
        'AccountDetail',
        'HoldingForm',
        'ReminderForm',
        'Statement',
      ]);
    });

    it('leaves an action with no source to the stack router', () => {
      const state = accountsWithTwoForms();
      const back = run(state, CommonActions.goBack());

      expect(names(back)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
    });

    it('leaves an action from a route the stack does not have to the stack router', () => {
      const state = accountsWithTwoForms();
      const back = run(state, from('a-route-of-a-child-navigator', CommonActions.goBack()));

      expect(names(back)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
    });

    it('leaves every action to the stack router while the navigator shows one pane', () => {
      const single = PaneRouter({ paneConfig: { rootPane: 'companion' }, isSplit: SINGLE });
      const state = single.getInitialState(CONFIG);
      const pushed = runWith(single)(state, StackActions.push('AccountDetail', { id: 'a' }));
      const navigated = runWith(single)(
        pushed,
        from(pushed.routes[0].key, CommonActions.navigate('AccountDetail', { id: 'b' })),
      );
      const back = runWith(single)(
        runWith(single)(navigated, StackActions.push('HoldingForm')),
        from(navigated.routes[1].key, CommonActions.goBack()),
      );

      expect(navigated.routes[1].key).toBe(pushed.routes[1].key);
      expect(navigated.routes[1].params).toEqual({ id: 'b' });
      expect(names(back)).toEqual(['Accounts', 'AccountDetail']);
    });

    describe('from a default that is the focused route', () => {
      // [Accounts(c), AccountDetail(p, default)]: the default is on top, so the stack router would
      // take it for the focused caller and open the next screen in its own pane.
      const withDefault = (): PaneStackState =>
        run(initial(), PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'first' }));

      it('opens a navigate beside it and makes the default a real route in its pane', () => {
        const shown = withDefault();
        const form = run(
          shown,
          from(keyOf(shown, 'AccountDetail'), CommonActions.navigate('HoldingForm')),
        );

        expect(names(form)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
        expect(form.routes.map((route) => route.isDefault)).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
        expect(paneNames(form, 'companion')).toEqual(['Accounts', 'HoldingForm']);
        expect(paneNames(form, 'primary')).toEqual(['AccountDetail']);
      });

      it('opens a push beside it too', () => {
        const shown = withDefault();
        const form = run(
          shown,
          from(keyOf(shown, 'AccountDetail'), StackActions.push('HoldingForm')),
        );

        expect(paneNames(form, 'companion')).toEqual(['Accounts', 'HoldingForm']);
        expect(paneNames(form, 'primary')).toEqual(['AccountDetail']);
      });

      it('keeps the page it opened from through a fold, and Back leads to it', () => {
        const shown = withDefault();
        const form = run(
          shown,
          from(keyOf(shown, 'AccountDetail'), CommonActions.navigate('HoldingForm')),
        );
        const folded = run(form, PaneActions.fold());
        const back = run(folded, from(keyOf(folded, 'HoldingForm'), CommonActions.goBack()));

        expect(names(folded)).toEqual(['Accounts', 'AccountDetail', 'HoldingForm']);
        expect(names(back)).toEqual(['Accounts', 'AccountDetail']);
        expect(back.routes[1].params).toEqual({ accountId: 'first' });
      });

      it.each([
        ['go back', CommonActions.goBack()],
        ['pop', StackActions.pop()],
        ['pop of several', StackActions.pop(2)],
      ])('does nothing on %s, and does not hand it to the parent navigator', (_label, action) => {
        const shown = withDefault();

        expect(
          router.getStateForAction(shown, from(keyOf(shown, 'AccountDetail'), action), CONFIG),
        ).toBe(shown);
      });
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
