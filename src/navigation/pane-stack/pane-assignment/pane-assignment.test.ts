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
    const opened = openFrom(
      [route('home', 'Home')],
      { home: 'primary' },
      'home',
      route('form'),
      HOME_TAB,
    );

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

  // was: the transaction opened in primary, covering the Statistics list.
  it('(c) opens a transaction from the Home companion (Statistics tab) in the companion, in place of the Home default', () => {
    const opened = openFrom(
      [route('statistics', 'Statistics')],
      { statistics: 'primary' },
      defaultRouteKey('companion'),
      route('transaction'),
      STATISTICS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['statistics', 'transaction']);
    expect(opened.panes).toEqual({ statistics: 'primary', transaction: 'companion' });
    expect(shown(opened.routes, opened.panes, STATISTICS_TAB)).toEqual({
      companion: 'transaction',
      primary: 'Statistics',
    });
  });

  it('(d) replaces the account page when a second row is tapped: [Accounts, B], no duplicate', () => {
    const first = openFrom(
      [route('accounts')],
      { accounts: 'companion' },
      'accounts',
      route('accountA'),
      ACCOUNTS_TAB,
    );
    const second = openFrom(first.routes, first.panes, 'accounts', route('accountB'), ACCOUNTS_TAB);

    expect(keys(second.routes)).toEqual(['accounts', 'accountB']);
    expect(second.panes).toEqual({ accounts: 'companion', accountB: 'primary' });
  });

  it('(d) keeps one detail when the same row is tapped twice', () => {
    const first = openFrom(
      [route('accounts')],
      { accounts: 'companion' },
      'accounts',
      route('detail-1'),
      ACCOUNTS_TAB,
    );
    const second = openFrom(first.routes, first.panes, 'accounts', route('detail-2'), ACCOUNTS_TAB);

    expect(keys(second.routes)).toEqual(['accounts', 'detail-2']);
  });

  // was: the holding form opened in the companion, covering the Accounts list.
  it('(e) opens a holding form from the account page (primary) in primary, on top of the account', () => {
    const opened = openFrom(
      [route('accounts', 'Accounts'), route('account', 'AccountDetail')],
      { accounts: 'companion', account: 'primary' },
      'account',
      route('holdingForm', 'HoldingForm'),
      ACCOUNTS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account', 'holdingForm']);
    expect(opened.panes.holdingForm).toBe('primary');
    expect(shown(opened.routes, opened.panes, ACCOUNTS_TAB)).toEqual({
      companion: 'Accounts',
      primary: 'HoldingForm',
    });
  });

  it('(f) restores the previous content of the pane when the route on top of it closes', () => {
    const closed = [route('accounts', 'Accounts'), route('account', 'AccountDetail')];

    expect(shown(closed, { accounts: 'companion', account: 'primary' }, ACCOUNTS_TAB)).toEqual({
      companion: 'Accounts',
      primary: 'AccountDetail',
    });
  });

  // was: form in the companion and nested in primary: the list pane held the form.
  it('(f) keeps the routes below the top of the detail pane, in stack order', () => {
    const routes = [route('accounts'), route('account'), route('form'), route('nested')];
    const panes: PaneMap = {
      accounts: 'companion',
      account: 'primary',
      form: 'primary',
      nested: 'primary',
    };

    expect(keys(routesOfPane(routes, panes, ACCOUNTS_TAB, 'companion'))).toEqual(['accounts']);
    expect(keys(routesOfPane(routes, panes, ACCOUNTS_TAB, 'primary'))).toEqual([
      'account',
      'form',
      'nested',
    ]);
  });

  it('(g) drops defaults on fold and keeps the pane of every tapped route', () => {
    const folded = foldAssignment(
      [route('accounts'), route('account', 'AccountDetail', { isDefault: true }), route('form')],
      { accounts: 'companion', account: 'primary', form: 'primary' },
    );

    // was: form in the companion.
    expect(keys(folded.routes)).toEqual(['accounts', 'form']);
    expect(folded.panes).toEqual({ accounts: 'companion', form: 'primary' });
  });

  it('(h) puts the form back in the companion and Home in primary after a fold and unfold', () => {
    const opened = openFrom(
      [route('home', 'Home')],
      { home: 'primary' },
      'home',
      route('form'),
      HOME_TAB,
    );
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

  // was: the form unfolded into primary, covering Statistics, with the Home default beside it.
  it('(j) folds the Statistics tab to [Statistics, Form], and unfolds with Form in the companion and Statistics in primary', () => {
    const opened = openFrom(
      [route('statistics', 'Statistics')],
      { statistics: 'primary' },
      defaultRouteKey('companion'),
      route('form', 'TransactionForm'),
      STATISTICS_TAB,
    );
    const folded = foldAssignment(opened.routes, opened.panes);

    expect(keys(folded.routes)).toEqual(['statistics', 'form']);

    const unfolded = unfoldAssignment(folded.routes, folded.panes, STATISTICS_TAB);

    expect(unfolded).toEqual({ statistics: 'primary', form: 'companion' });
    expect(shown(folded.routes, unfolded, STATISTICS_TAB)).toEqual({
      companion: 'TransactionForm',
      primary: 'Statistics',
    });
  });

  it('(k) unfolds a route pushed while folded into the detail pane', () => {
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

  // was: [a, b, c] unfolded to [list, detail, list] (companion root) and the mirror for a primary
  // root: the route above the detail covered the list.
  it('(m) unfolds a state without a pane map with the root in its pane and every other route in the other', () => {
    const routes = [route('a'), route('b'), route('c')];

    expect(unfoldAssignment(routes, {}, ACCOUNTS_TAB)).toEqual({
      a: 'companion',
      b: 'primary',
      c: 'primary',
    });
    expect(unfoldAssignment(routes, {}, HOME_TAB)).toEqual({
      a: 'primary',
      b: 'companion',
      c: 'companion',
    });
  });

  it('keeps a stored pane, and puts a route without one in the detail pane', () => {
    const routes = [route('a'), route('b'), route('c')];

    // was: { a: companion, b: companion, c: primary }: c alternated from the stored b.
    expect(unfoldAssignment(routes, { b: 'companion' }, ACCOUNTS_TAB)).toEqual({
      a: 'companion',
      b: 'companion',
      c: 'primary',
    });
    expect(unfoldAssignment(routes, { c: 'companion' }, ACCOUNTS_TAB)).toEqual({
      a: 'companion',
      b: 'primary',
      c: 'companion',
    });
  });

  it('puts a default route in the detail pane too, so folding it away moves no route above it', () => {
    const routes = [
      route('accounts'),
      route('first', 'AccountDetail', { isDefault: true }),
      route('form'),
      route('nested'),
    ];
    const withDefault = unfoldAssignment(routes, { first: 'primary' }, ACCOUNTS_TAB);
    const folded = foldAssignment(routes, withDefault);

    // was: nested in the companion (it alternated from form).
    expect(withDefault).toEqual({
      accounts: 'companion',
      first: 'primary',
      form: 'primary',
      nested: 'primary',
    });
    // was: nested in the companion.
    expect(unfoldAssignment(folded.routes, {}, ACCOUNTS_TAB)).toEqual({
      accounts: 'companion',
      form: 'primary',
      nested: 'primary',
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
      ACCOUNTS_TAB,
    );

    expect(opened.routes.map((entry) => entry.isDefault)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    // was: holdingForm in the companion.
    expect(opened.panes).toEqual({
      accounts: 'companion',
      first: 'primary',
      holdingForm: 'primary',
    });
  });

  it('keeps the isDefault flag of an opener that is a placeholder', () => {
    const opened = openFrom(
      [
        route('accounts'),
        route('empty', 'AccountsEmptyPane', { isDefault: true, isPlaceholder: true }),
      ],
      { accounts: 'companion', empty: 'primary' },
      'empty',
      route('form'),
      ACCOUNTS_TAB,
    );

    expect(opened.routes.map((entry) => entry.isDefault)).toEqual([undefined, true, undefined]);
    // was: the form in the companion.
    expect(opened.panes.form).toBe('primary');
  });

  it('opens from a route in the middle of the stack by popping everything above it', () => {
    const opened = openFrom(
      [route('accounts'), route('account'), route('form')],
      { accounts: 'companion', account: 'primary', form: 'primary' },
      'account',
      route('form2'),
      ACCOUNTS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account', 'form2']);
    // was: form2 in the companion.
    expect(opened.panes).toEqual({ accounts: 'companion', account: 'primary', form2: 'primary' });
  });

  it('opens from a static default as if it sat right above the root', () => {
    const opened = openFrom(
      [route('statistics'), route('transaction')],
      { statistics: 'primary', transaction: 'companion' },
      defaultRouteKey('companion'),
      route('transaction2'),
      STATISTICS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['statistics', 'transaction2']);
    // was: transaction2 in primary, over the Statistics list.
    expect(opened.panes.transaction2).toBe('companion');
  });

  it('moves a route that the opened one reuses to the top instead of listing it twice', () => {
    const opened = openFrom(
      [route('accounts'), route('account')],
      { accounts: 'companion', account: 'primary' },
      'accounts',
      route('account'),
      ACCOUNTS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['accounts', 'account']);
    expect(opened.panes).toEqual({ accounts: 'companion', account: 'primary' });
  });

  it('leaves everything alone when the opener is unknown', () => {
    const routes = [route('a')];
    const panes: PaneMap = { a: 'primary' };
    const opened = openFrom(routes, panes, 'missing', route('b'), ACCOUNTS_TAB);

    expect(opened.routes).toBe(routes);
    expect(opened.panes).toBe(panes);
  });

  it('names the pane of a static default key', () => {
    expect(paneOfDefaultKey(defaultRouteKey('companion'))).toBe('companion');
    expect(paneOfDefaultKey(defaultRouteKey('primary'))).toBe('primary');
    expect(paneOfDefaultKey('home')).toBeUndefined();
  });
});

type Walk = { routes: RouteLike[]; panes: PaneMap };

const MAX_OPENS = 6;

const WALK_CONFIGS: ReadonlyArray<readonly [string, PaneConfig]> = [
  ['companion root, no default', { rootPane: 'companion' }],
  ['primary root, no default', { rootPane: 'primary' }],
  [
    'companion root, default in the detail pane',
    { rootPane: 'companion', primaryDefault: { name: 'AccountDetail', isDefault: true } },
  ],
  [
    'primary root, default in the detail pane',
    { rootPane: 'primary', companionDefault: STATISTICS_DEFAULT },
  ],
];

const detailPaneOf = (config: PaneConfig): Pane =>
  config.rootPane === 'companion' ? 'primary' : 'companion';

// Every route of the stack, plus the key of the default the detail pane shows while it has no
// route: the openers a screen can name, the covered ones included.
const openersOf = (walk: Walk, config: PaneConfig): string[] => {
  const detail = detailPaneOf(config);
  const hasDefault =
    routesOfPane(walk.routes, walk.panes, config, detail).length === 0 &&
    paneDefault(config, detail) !== null;

  return [
    ...walk.routes.map((entry) => entry.key),
    ...(hasDefault ? [defaultRouteKey(detail)] : []),
  ];
};

// What breaks the one rule of the layout after a walk: the list pane holds the root and nothing
// else, and a fold followed by an unfold (or an unfold that has lost the stored panes) puts
// every route back where it was.
const brokenBy = (walk: Walk, config: PaneConfig): string[] => {
  const [root, ...rest] = walk.routes;
  const panes = unfoldAssignment(walk.routes, walk.panes, config);
  const inList = routesOfPane(walk.routes, panes, config, config.rootPane);
  const folded = foldAssignment(walk.routes, walk.panes);

  return [
    ...(keys(inList).join() === root.key ? [] : [`list pane holds ${keys(inList).join()}`]),
    ...rest
      .filter((entry) => panes[entry.key] !== detailPaneOf(config))
      .map((entry) => `${entry.key} is not in the detail pane`),
    ...(JSON.stringify(unfoldAssignment(folded.routes, folded.panes, config)) ===
    JSON.stringify(panes)
      ? []
      : ['fold then unfold moved a route']),
    ...(JSON.stringify(unfoldAssignment(walk.routes, {}, config)) === JSON.stringify(panes)
      ? []
      : ['the stored panes differ from the ones the index gives']),
  ];
};

// Opens a fresh route from each possible opener, deeper and deeper, the way the router does: it
// hands `openFrom` the panes it resolved from the state.
const walkOpens = (walk: Walk, config: PaneConfig, trail: string[], depth: number): string[] =>
  depth === MAX_OPENS
    ? []
    : openersOf(walk, config).flatMap((openerKey) => {
        const step = [...trail, `${openerKey}>r${depth}`];
        const opened = openFrom(
          walk.routes,
          unfoldAssignment(walk.routes, walk.panes, config),
          openerKey,
          route(`r${depth}`),
          config,
        );

        return [
          ...brokenBy(opened, config).map((problem) => `${step.join(' ')}: ${problem}`),
          ...walkOpens(opened, config, step, depth + 1),
        ];
      });

describe('the list pane holds only the root', () => {
  it.each(WALK_CONFIGS)(
    'for every sequence of %s opens up to six deep, from any route or the default',
    (_name, config) => {
      const start: Walk = { routes: [route('root')], panes: { root: config.rootPane } };

      expect(walkOpens(start, config, [], 0)).toEqual([]);
    },
  );
});
