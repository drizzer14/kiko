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
  wholeWindowPaneOf,
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

  it('(c) openFrom falls back to the companion pane when the opener is a static default key not in the stack', () => {
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

  it('(j) openFrom fallback from a static default key: the fold drops nothing, and unfolding puts the form in the companion and Statistics in primary', () => {
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

    expect(withDefault).toEqual({
      accounts: 'companion',
      first: 'primary',
      form: 'primary',
      nested: 'primary',
    });
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
    expect(opened.panes).toEqual({ accounts: 'companion', account: 'primary', form2: 'primary' });
  });

  it('opens from the real route a static default became, right above it and below the form', () => {
    const opened = openFrom(
      [route('statistics'), route('home', 'Home', { isDefault: true })],
      { statistics: 'primary', home: 'companion' },
      'home',
      route('transaction'),
      STATISTICS_TAB,
    );

    expect(keys(opened.routes)).toEqual(['statistics', 'home', 'transaction']);
    expect(opened.routes[1].isDefault).toBeUndefined();
    expect(opened.panes).toEqual({
      statistics: 'primary',
      home: 'companion',
      transaction: 'companion',
    });
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

const WHOLE_WINDOW = ['Tables'] as const;
const WHOLE_HOME_TAB: PaneConfig = { ...HOME_TAB, wholeWindowRoutes: WHOLE_WINDOW };
const WHOLE_STATISTICS_TAB: PaneConfig = { ...STATISTICS_TAB, wholeWindowRoutes: WHOLE_WINDOW };

describe('a whole-window route', () => {
  describe('opens in the pane of the route below it', () => {
    it('from the static default beside Home: in Home’s pane, with the default left alone', () => {
      const opened = openFrom(
        [route('home', 'Home')],
        { home: 'primary' },
        defaultRouteKey('companion'),
        route('tables', 'Tables'),
        WHOLE_HOME_TAB,
      );

      expect(keys(opened.routes)).toEqual(['home', 'tables']);
      expect(opened.panes).toEqual({ home: 'primary', tables: 'primary' });
      expect(shown(opened.routes, opened.panes, WHOLE_HOME_TAB)).toEqual({
        companion: 'Statistics',
        primary: 'Tables',
      });
    });

    it('from the Statistics root: in the root’s pane', () => {
      const opened = openFrom(
        [route('statistics', 'Statistics')],
        { statistics: 'primary' },
        'statistics',
        route('tables', 'Tables'),
        WHOLE_STATISTICS_TAB,
      );

      expect(opened.panes).toEqual({ statistics: 'primary', tables: 'primary' });
      expect(shown(opened.routes, opened.panes, WHOLE_STATISTICS_TAB)).toEqual({
        companion: 'Home',
        primary: 'Tables',
      });
    });

    it('from a real route in the companion pane: in the companion pane', () => {
      const opened = openFrom(
        [route('home', 'Home'), route('statistics', 'Statistics')],
        { home: 'primary', statistics: 'companion' },
        'statistics',
        route('tables', 'Tables'),
        WHOLE_HOME_TAB,
      );

      expect(keys(opened.routes)).toEqual(['home', 'statistics', 'tables']);
      expect(opened.panes).toEqual({
        home: 'primary',
        statistics: 'companion',
        tables: 'companion',
      });
    });

    it('from a route that has a form above it: the form closes and Tables takes the opener’s pane', () => {
      const opened = openFrom(
        [route('statistics', 'Statistics'), route('form', 'TransactionForm')],
        { statistics: 'primary', form: 'companion' },
        'statistics',
        route('tables', 'Tables'),
        WHOLE_STATISTICS_TAB,
      );

      expect(keys(opened.routes)).toEqual(['statistics', 'tables']);
      expect(opened.panes).toEqual({ statistics: 'primary', tables: 'primary' });
    });

    it('opens a route that is not listed in the detail pane, as before', () => {
      const opened = openFrom(
        [route('home', 'Home')],
        { home: 'primary' },
        'home',
        route('form', 'TransactionForm'),
        WHOLE_HOME_TAB,
      );

      expect(opened.panes).toEqual({ home: 'primary', form: 'companion' });
    });

    it('opens the same name in the detail pane when the config lists no whole-window route', () => {
      const opened = openFrom(
        [route('home', 'Home')],
        { home: 'primary' },
        defaultRouteKey('companion'),
        route('tables', 'Tables'),
        HOME_TAB,
      );

      expect(opened.panes).toEqual({ home: 'primary', tables: 'companion' });
    });
  });

  describe('without a stored pane', () => {
    it('takes the pane of the route below it', () => {
      const routes = [
        route('home', 'Home'),
        route('statistics', 'Statistics'),
        route('tables', 'Tables'),
      ];

      expect(unfoldAssignment(routes, { home: 'primary' }, WHOLE_HOME_TAB)).toEqual({
        home: 'primary',
        statistics: 'companion',
        tables: 'companion',
      });
      expect(
        routesOfPane(routes, { home: 'primary' }, WHOLE_HOME_TAB, 'companion').map(
          (entry) => entry.key,
        ),
      ).toEqual(['statistics', 'tables']);
    });

    it('sits in the root pane above a root that is alone', () => {
      const routes = [route('statistics', 'Statistics'), route('tables', 'Tables')];

      expect(unfoldAssignment(routes, {}, WHOLE_STATISTICS_TAB)).toEqual({
        statistics: 'primary',
        tables: 'primary',
      });
    });

    it('is the root’s own pane when it is the root', () => {
      expect(unfoldAssignment([route('tables', 'Tables')], {}, WHOLE_STATISTICS_TAB)).toEqual({
        tables: 'primary',
      });
    });

    it('keeps a stored pane over the pane of the route below', () => {
      const routes = [route('statistics', 'Statistics'), route('tables', 'Tables')];

      expect(unfoldAssignment(routes, { tables: 'companion' }, WHOLE_STATISTICS_TAB).tables).toBe(
        'companion',
      );
    });

    it('goes to the detail pane when the config lists no whole-window route', () => {
      const routes = [route('statistics', 'Statistics'), route('tables', 'Tables')];

      expect(unfoldAssignment(routes, {}, STATISTICS_TAB).tables).toBe('companion');
    });
  });

  describe('keeps its pane through a fold and an unfold', () => {
    it('for Tables opened from the static default', () => {
      const opened = openFrom(
        [route('home', 'Home')],
        { home: 'primary' },
        defaultRouteKey('companion'),
        route('tables', 'Tables'),
        WHOLE_HOME_TAB,
      );
      const folded = foldAssignment(opened.routes, opened.panes);

      expect(unfoldAssignment(folded.routes, folded.panes, WHOLE_HOME_TAB)).toEqual(opened.panes);
    });
  });

  describe('wholeWindowPaneOf', () => {
    const tablesOnHome = [route('home', 'Home'), route('tables', 'Tables')];

    it('names the pane of a listed route on top', () => {
      expect(wholeWindowPaneOf(tablesOnHome, { home: 'primary' }, WHOLE_HOME_TAB)).toBe('primary');
      expect(
        wholeWindowPaneOf(
          [route('home', 'Home'), route('statistics', 'Statistics'), route('tables', 'Tables')],
          { home: 'primary', statistics: 'companion' },
          WHOLE_HOME_TAB,
        ),
      ).toBe('companion');
    });

    it('is null while the listed route is covered by another', () => {
      expect(
        wholeWindowPaneOf(
          [...tablesOnHome, route('form', 'TransactionForm')],
          { home: 'primary' },
          WHOLE_HOME_TAB,
        ),
      ).toBeNull();
    });

    it('is null when the top route is not listed, the config lists none, or there is no route', () => {
      expect(wholeWindowPaneOf([route('home', 'Home')], { home: 'primary' }, WHOLE_HOME_TAB)).toBe(
        null,
      );
      expect(wholeWindowPaneOf(tablesOnHome, { home: 'primary' }, HOME_TAB)).toBeNull();
      expect(wholeWindowPaneOf([], {}, WHOLE_HOME_TAB)).toBeNull();
    });
  });
});
