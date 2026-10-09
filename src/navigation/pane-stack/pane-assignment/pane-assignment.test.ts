import {
  defaultRouteKey,
  foldAssignment,
  openFrom,
  type Pane,
  type PaneConfig,
  paneDefault,
  type PaneMap,
  paneOfDefaultKey,
  type RouteLike,
  routesOfPane,
  unfoldAssignment,
} from '.';

const route = (key: string, name = key, extra: Partial<RouteLike> = {}): RouteLike => ({
  key,
  name,
  ...extra,
});

const keys = (routes: RouteLike[]) => routes.map((entry) => entry.key);

const STATISTICS_DEFAULT = { name: 'Statistics', isDefault: true } as const;
const HOME_DEFAULT = { name: 'Home', isDefault: true } as const;

const HOME_TAB: PaneConfig = { rootPane: 'primary', companionDefault: STATISTICS_DEFAULT };
const STATISTICS_TAB: PaneConfig = { rootPane: 'primary', companionDefault: HOME_DEFAULT };
const ACCOUNTS_TAB: PaneConfig = { rootPane: 'companion' };

// What a pane shows, as a name for its top route, or for its default when it has no route.
const shownIn = (routes: RouteLike[], panes: PaneMap, config: PaneConfig, pane: Pane) =>
  (routesOfPane(routes, panes, config, pane).at(-1) ?? paneDefault(config, pane))?.name ?? null;

const shown = (routes: RouteLike[], panes: PaneMap, config: PaneConfig) => ({
  companion: shownIn(routes, panes, config, 'companion'),
  primary: shownIn(routes, panes, config, 'primary'),
});

describe('pane assignment', () => {
  it('(a) opens the form from Home (primary) in the companion, in place of Statistics', () => {
    const opened = openFrom([route('home', 'Home')], { home: 'primary' }, 'home', route('form'));

    expect(keys(opened.routes)).toEqual(['home', 'form']);
    expect(opened.panes).toEqual({ home: 'primary', form: 'companion' });
    expect(shown(opened.routes, opened.panes, HOME_TAB)).toEqual({
      companion: 'form',
      primary: 'Home',
    });
  });

  it('(b) shows the Statistics default again once the form is closed', () => {
    expect(shown([route('home', 'Home')], { home: 'primary' }, HOME_TAB)).toEqual({
      companion: 'Statistics',
      primary: 'Home',
    });
    expect(
      routesOfPane([route('home', 'Home')], { home: 'primary' }, HOME_TAB, 'companion'),
    ).toEqual([]);
    expect(paneDefault(HOME_TAB, 'companion')).toBe(STATISTICS_DEFAULT);
  });

  it('(c) opens a transaction from the Home companion (Statistics tab) in primary, in place of Statistics', () => {
    const opened = openFrom(
      [route('statistics', 'Statistics')],
      { statistics: 'primary' },
      defaultRouteKey('companion'),
      route('transaction'),
    );

    expect(keys(opened.routes)).toEqual(['statistics', 'transaction']);
    expect(opened.panes).toEqual({ statistics: 'primary', transaction: 'primary' });
    expect(shown(opened.routes, opened.panes, STATISTICS_TAB)).toEqual({
      companion: 'Home',
      primary: 'transaction',
    });
  });

  it('(d) replaces the account page when a second row is tapped: [Accounts, B], no duplicate', () => {
    const first = openFrom(
      [route('accounts')],
      { accounts: 'companion' },
      'accounts',
      route('accountA'),
    );
    const second = openFrom(first.routes, first.panes, 'accounts', route('accountB'));

    expect(keys(second.routes)).toEqual(['accounts', 'accountB']);
    expect(second.panes).toEqual({ accounts: 'companion', accountB: 'primary' });
  });

  it('(d) keeps one detail when the same row is tapped twice', () => {
    const first = openFrom(
      [route('accounts')],
      { accounts: 'companion' },
      'accounts',
      route('detail-1'),
    );
    const second = openFrom(first.routes, first.panes, 'accounts', route('detail-2'));

    expect(keys(second.routes)).toEqual(['accounts', 'detail-2']);
  });

  it('(e) opens a holding form from the account page (primary) in the companion, in place of the list', () => {
    const opened = openFrom(
      [route('accounts', 'Accounts'), route('account', 'AccountDetail')],
      { accounts: 'companion', account: 'primary' },
      'account',
      route('holdingForm', 'HoldingForm'),
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account', 'holdingForm']);
    expect(opened.panes.holdingForm).toBe('companion');
    expect(shown(opened.routes, opened.panes, ACCOUNTS_TAB)).toEqual({
      companion: 'HoldingForm',
      primary: 'AccountDetail',
    });
  });

  it('(f) restores the previous content of the pane when the route on top of it closes', () => {
    const closed = [route('accounts', 'Accounts'), route('account', 'AccountDetail')];

    expect(shown(closed, { accounts: 'companion', account: 'primary' }, ACCOUNTS_TAB)).toEqual({
      companion: 'Accounts',
      primary: 'AccountDetail',
    });
  });

  it('(f) keeps routes below the opener that a later route of the same pane covered', () => {
    const routes = [route('accounts'), route('account'), route('form'), route('nested')];
    const panes: PaneMap = {
      accounts: 'companion',
      account: 'primary',
      form: 'companion',
      nested: 'primary',
    };

    expect(keys(routesOfPane(routes, panes, ACCOUNTS_TAB, 'companion'))).toEqual([
      'accounts',
      'form',
    ]);
    expect(keys(routesOfPane(routes, panes, ACCOUNTS_TAB, 'primary'))).toEqual([
      'account',
      'nested',
    ]);
  });

  it('(g) drops defaults on fold and keeps the pane of every tapped route', () => {
    const folded = foldAssignment(
      [route('accounts'), route('account', 'AccountDetail', { isDefault: true }), route('form')],
      { accounts: 'companion', account: 'primary', form: 'companion' },
    );

    expect(keys(folded.routes)).toEqual(['accounts', 'form']);
    expect(folded.panes).toEqual({ accounts: 'companion', form: 'companion' });
  });

  it('(h) puts the form back in the companion and Home in primary after a fold and unfold', () => {
    const opened = openFrom([route('home', 'Home')], { home: 'primary' }, 'home', route('form'));
    const folded = foldAssignment(opened.routes, opened.panes);
    const unfolded = unfoldAssignment(folded.routes, folded.panes, HOME_TAB);

    expect(unfolded).toEqual({ home: 'primary', form: 'companion' });
    expect(shown(folded.routes, unfolded, HOME_TAB)).toEqual({
      companion: 'form',
      primary: 'Home',
    });
  });

  it('(i) puts the list in the companion and the detail in primary when unfolding [Accounts, AccountDetail]', () => {
    const routes = [route('accounts', 'Accounts'), route('account', 'AccountDetail')];
    const unfolded = unfoldAssignment(routes, {}, ACCOUNTS_TAB);

    expect(unfolded).toEqual({ accounts: 'companion', account: 'primary' });
    expect(shown(routes, unfolded, ACCOUNTS_TAB)).toEqual({
      companion: 'Accounts',
      primary: 'AccountDetail',
    });
  });

  it('(j) folds the Statistics tab to [Statistics, Form], and unfolds with Form in primary and the Home default', () => {
    const opened = openFrom(
      [route('statistics', 'Statistics')],
      { statistics: 'primary' },
      defaultRouteKey('companion'),
      route('form', 'TransactionForm'),
    );
    const folded = foldAssignment(opened.routes, opened.panes);

    expect(keys(folded.routes)).toEqual(['statistics', 'form']);

    const unfolded = unfoldAssignment(folded.routes, folded.panes, STATISTICS_TAB);

    expect(unfolded).toEqual({ statistics: 'primary', form: 'primary' });
    expect(shown(folded.routes, unfolded, STATISTICS_TAB)).toEqual({
      companion: 'Home',
      primary: 'TransactionForm',
    });
  });

  it('(k) unfolds a route pushed while folded into the pane opposite the route below', () => {
    const unfolded = unfoldAssignment(
      [route('home'), route('form')],
      { home: 'primary' },
      HOME_TAB,
    );

    expect(unfolded).toEqual({ home: 'primary', form: 'companion' });
  });

  it('(l) drops the default first account on fold and shows it again in primary after unfold', () => {
    const config: PaneConfig = {
      rootPane: 'companion',
      primaryDefault: { name: 'AccountDetail', params: { accountId: 'first' }, isDefault: true },
    };
    const folded = foldAssignment(
      [route('accounts'), route('first', 'AccountDetail', { isDefault: true })],
      { accounts: 'companion', first: 'primary' },
    );

    expect(keys(folded.routes)).toEqual(['accounts']);
    expect(
      routesOfPane(
        folded.routes,
        unfoldAssignment(folded.routes, folded.panes, config),
        config,
        'primary',
      ),
    ).toEqual([]);
    expect(paneDefault(config, 'primary')).toBe(config.primaryDefault);
  });

  it('(m) unfolds a state without a pane map by alternation from the root pane', () => {
    const routes = [route('a'), route('b'), route('c')];

    expect(unfoldAssignment(routes, {}, ACCOUNTS_TAB)).toEqual({
      a: 'companion',
      b: 'primary',
      c: 'companion',
    });
    expect(unfoldAssignment(routes, {}, HOME_TAB)).toEqual({
      a: 'primary',
      b: 'companion',
      c: 'primary',
    });
  });

  it('keeps a stored pane and alternates from it for the routes without one', () => {
    const routes = [route('a'), route('b'), route('c')];

    expect(unfoldAssignment(routes, { b: 'companion' }, ACCOUNTS_TAB)).toEqual({
      a: 'companion',
      b: 'companion',
      c: 'primary',
    });
  });

  it('alternates past a default route, so folding it away moves no route above it', () => {
    const routes = [
      route('accounts'),
      route('first', 'AccountDetail', { isDefault: true }),
      route('form'),
      route('nested'),
    ];
    const withDefault = unfoldAssignment(routes, { first: 'primary' }, ACCOUNTS_TAB);
    const folded = foldAssignment(routes, withDefault);

    expect(withDefault).toEqual({
      accounts: 'companion',
      first: 'primary',
      form: 'primary',
      nested: 'companion',
    });
    expect(unfoldAssignment(folded.routes, {}, ACCOUNTS_TAB)).toEqual({
      accounts: 'companion',
      form: 'primary',
      nested: 'companion',
    });
  });

  it('shows the top route of each pane, and nothing for a pane with no route and no default', () => {
    const routes = [route('accounts', 'Accounts')];

    expect(shown(routes, {}, ACCOUNTS_TAB)).toEqual({ companion: 'Accounts', primary: null });
  });

  it('drops the isDefault flag of the opener route (materialization) and prunes closed keys', () => {
    const opened = openFrom(
      [route('accounts'), route('first', 'AccountDetail', { isDefault: true })],
      { accounts: 'companion', first: 'primary' },
      'first',
      route('holdingForm'),
    );

    expect(opened.routes.map((entry) => entry.isDefault)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(opened.panes).toEqual({
      accounts: 'companion',
      first: 'primary',
      holdingForm: 'companion',
    });
  });

  it('opens from a route in the middle of the stack by popping everything above it', () => {
    const opened = openFrom(
      [route('accounts'), route('account'), route('form')],
      { accounts: 'companion', account: 'primary', form: 'companion' },
      'account',
      route('form2'),
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account', 'form2']);
    expect(opened.panes).toEqual({ accounts: 'companion', account: 'primary', form2: 'companion' });
  });

  it('opens from a static default as if it sat right above the root', () => {
    const opened = openFrom(
      [route('statistics'), route('transaction')],
      { statistics: 'primary', transaction: 'primary' },
      defaultRouteKey('companion'),
      route('transaction2'),
    );

    expect(keys(opened.routes)).toEqual(['statistics', 'transaction2']);
    expect(opened.panes.transaction2).toBe('primary');
  });

  it('moves a route that the opened one reuses to the top instead of listing it twice', () => {
    const opened = openFrom(
      [route('accounts'), route('account')],
      { accounts: 'companion', account: 'primary' },
      'accounts',
      route('account'),
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account']);
    expect(opened.panes).toEqual({ accounts: 'companion', account: 'primary' });
  });

  it('leaves everything alone when the opener is unknown', () => {
    const routes = [route('a')];
    const panes: PaneMap = { a: 'primary' };
    const opened = openFrom(routes, panes, 'missing', route('b'));

    expect(opened.routes).toBe(routes);
    expect(opened.panes).toBe(panes);
  });

  it('names the pane of a static default key', () => {
    expect(paneOfDefaultKey(defaultRouteKey('companion'))).toBe('companion');
    expect(paneOfDefaultKey(defaultRouteKey('primary'))).toBe('primary');
    expect(paneOfDefaultKey('home')).toBeUndefined();
  });
});
