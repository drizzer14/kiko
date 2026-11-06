import type { ComponentProps } from 'react';
import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { MarkedChain } from '@kiko/recurring/marked-series';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { paneStackModule as mockPaneStackModule } from '@kiko/test-support/mock-pane-stack';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

type Choices = ReadonlyMap<string, { name: string; hidden?: true }>;

type SeriesState = {
  series: RecurringSeries[];
  markedSeries: RecurringSeries[];
  withoutCharges: MarkedChain[];
  choices: Choices;
  isLoading: boolean;
};

type ChargeRow = {
  id: string;
  amountMinorUnits: number;
  currency: 'UAH';
  category: string | null;
};

type GroupsState = { groups: unknown[]; total: unknown; isLoading: boolean };

const EMPTY_STATE: SeriesState = {
  series: [],
  markedSeries: [],
  withoutCharges: [],
  choices: new Map(),
  isLoading: false,
};

let mockSeriesState: SeriesState = EMPTY_STATE;

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockSeriesState,
}));

// The real grouping over the rows of the world, so what the screen hands the hook decides what
// it shows; a test that needs a state the rows cannot make (loading) sets the override.
let mockRows: ChargeRow[] = [];
let mockGroupsOverride: GroupsState | undefined;
const mockGroupsCalls: [shown: RecurringSeries[], all: RecurringSeries[]][] = [];

const mockCategories = [
  { key: 'utilities', title: 'Utilities', icon: 'bolt.fill', color: null },
  { key: 'subscriptions', title: 'Subscriptions', icon: 'play.rectangle.fill', color: null },
  { key: 'other', title: 'Other', icon: 'tag.fill', color: null },
];

jest.mock('@kiko/recurring/use-recurring-groups', () => ({
  useRecurringGroups: (shown: RecurringSeries[], all: RecurringSeries[]) => {
    mockGroupsCalls.push([shown, all]);

    if (mockGroupsOverride !== undefined) {
      return mockGroupsOverride;
    }

    const { recurringGroupsOf } = jest.requireActual('@kiko/recurring/recurring-groups');
    const { buildRateTable } = jest.requireActual('@kiko/rates/net-worth-view');

    return {
      ...recurringGroupsOf({
        shown,
        rows: mockRows,
        categories: mockCategories,
        defaultCategoryKey: 'other',
        baseCurrency: 'UAH',
        rateTable: buildRateTable([]),
      }),
      isLoading: false,
    };
  },
}));

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => mockPaneStackModule(() => mockOpenInPane));

const OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();
const SEPTEMBER = new Date(2026, 8, 15, 9, 30).getTime();

type Spec = {
  name: string;
  charges: number[];
  category: string | null;
  // The series has no row in the charges read at all.
  noRows?: true;
  lastChargeTime?: number;
  isStopped?: boolean;
};

const idOf = (name: string): string => name.toLowerCase();

const seriesOf = ({ name, charges, lastChargeTime, isStopped }: Spec): RecurringSeries => ({
  id: idOf(name),
  merchantKey: idOf(name),
  name,
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: charges.map((_, index) => `${idOf(name)}-${index}`),
  lastChargeTime: lastChargeTime ?? OCTOBER,
  lastChargeAmountMinorUnits: charges[0] * 100,
  lastChargeHoldingId: 'holding-1',
  isStopped: isStopped ?? false,
  quiet: null,
});

const rowsOf = ({ name, charges, category, noRows }: Spec): ChargeRow[] =>
  noRows === true
    ? []
    : charges.map((major, index) => ({
        id: `${idOf(name)}-${index}`,
        amountMinorUnits: -major * 100,
        currency: 'UAH',
        category,
      }));

const worldOf = (specs: Spec[], overrides: Partial<SeriesState> = {}) => {
  mockSeriesState = { ...EMPTY_STATE, series: specs.map(seriesOf), ...overrides };
  mockRows = specs.flatMap(rowsOf);
};

const renderScreen = async () =>
  render(
    <RecurringChargesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
    />,
    { wrapper: GestureRootWrapper },
  );

const moneyText = (minorUnits: number): string =>
  formatMoney(Money.of('UAH', minorUnits), activeLocale());

const rowId = (name: string): string => `recurring-series-row-${idOf(name)}`;

const LAYOUT_IDS =
  /^(recurring-charges-(total|group-|divider-|heading-|marked-empty-|hidden-)|recurring-series-row-)/;

const layoutOf = (tree: Awaited<ReturnType<typeof renderScreen>>): string[] =>
  testIdsInOrder(tree.toJSON()).filter((testId) => LAYOUT_IDS.test(testId));

// Utilities come first in the categories, though Subscriptions is the larger total and sorts
// first by name; the stopped Spotify has the newest last charge, so only the stopped-after-active
// rule puts it behind Netflix.
const TWO_GROUPS: Spec[] = [
  { name: 'Netflix', charges: [299, 299, 299], category: 'subscriptions' },
  {
    name: 'Spotify',
    charges: [99, 99],
    category: 'subscriptions',
    isStopped: true,
    lastChargeTime: new Date(2026, 9, 20, 9, 30).getTime(),
  },
  { name: 'Power', charges: [300, 300], category: 'utilities', lastChargeTime: SEPTEMBER },
];

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  mockOpenInPane.mockClear();
  mockGroupsCalls.length = 0;
  mockGroupsOverride = undefined;
  mockSeriesState = EMPTY_STATE;
  mockRows = [];
});

describe('RecurringChargesScreen — category groups', () => {
  it('lists the total of all, then each group in the categories order with its series', async () => {
    worldOf(TWO_GROUPS);

    const tree = await renderScreen();

    expect(layoutOf(tree)).toEqual([
      'recurring-charges-total',
      'recurring-charges-divider-group-utilities',
      'recurring-charges-group-utilities',
      'recurring-charges-group-total-utilities',
      rowId('Power'),
      'recurring-charges-divider-group-subscriptions',
      'recurring-charges-group-subscriptions',
      'recurring-charges-group-total-subscriptions',
      rowId('Netflix'),
      rowId('Spotify'),
    ]);
  });

  it('shows the last-charges label and the sum of the group totals in the total of all', async () => {
    worldOf(TWO_GROUPS);

    const { getByTestId } = await renderScreen();
    const total = within(getByTestId('recurring-charges-total'));

    expect(total.getByText('Sum of last charges')).toBeTruthy();
    expect(total.queryByText('All paid so far')).toBeNull();
    expect(total.getByText(moneyText(30000 + 29900 + 9900))).toBeTruthy();
  });

  it('shows each heading with its category title, icon tile and own total', async () => {
    worldOf(TWO_GROUPS);

    const { getByTestId } = await renderScreen();
    const utilities = within(getByTestId('recurring-charges-group-utilities'));
    const subscriptions = within(getByTestId('recurring-charges-group-subscriptions'));

    expect(utilities.getByText('Utilities')).toBeTruthy();
    expect(utilities.getByTestId('entity-icon-tile')).toBeTruthy();
    expect(
      within(getByTestId('recurring-charges-group-total-utilities')).getByText(moneyText(30000)),
    ).toBeTruthy();
    expect(subscriptions.getByText('Subscriptions')).toBeTruthy();
    expect(subscriptions.getByTestId('entity-icon-tile')).toBeTruthy();
    expect(
      within(getByTestId('recurring-charges-group-total-subscriptions')).getByText(
        moneyText(29900 + 9900),
      ),
    ).toBeTruthy();
  });

  it('keeps a stopped series in its group after the active ones, under no stopped heading', async () => {
    worldOf(TWO_GROUPS);

    const tree = await renderScreen();
    const order = layoutOf(tree);

    expect(tree.queryByTestId('recurring-charges-heading-stopped')).toBeNull();
    expect(order.indexOf(rowId('Netflix'))).toBeLessThan(order.indexOf(rowId('Spotify')));
    expect(order.indexOf(rowId('Spotify'))).toBeGreaterThan(
      order.indexOf('recurring-charges-group-subscriptions'),
    );
    expect(order.indexOf(rowId('Power'))).toBeLessThan(
      order.indexOf('recurring-charges-group-subscriptions'),
    );
  });

  it('hands the hook the shown series, and every series with the hidden ones among them', async () => {
    worldOf(TWO_GROUPS, { choices: new Map([['spotify', { name: 'Spotify', hidden: true }]]) });

    const { queryByTestId } = await renderScreen();
    const [shown, all] = mockGroupsCalls.at(-1) ?? [[], []];

    expect(shown.map(({ id }) => id).sort()).toEqual(['netflix', 'power']);
    expect(all.map(({ id }) => id).sort()).toEqual(['netflix', 'power', 'spotify']);
    expect(queryByTestId(rowId('Spotify'))).toBeNull();
  });
});

describe('RecurringChargesScreen — the total row label, in uk', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('reads the total of all as the sum of last charges', async () => {
    worldOf(TWO_GROUPS);

    const { getByTestId } = await renderScreen();
    const total = within(getByTestId('recurring-charges-total'));

    expect(total.getByText('Сума останніх списань')).toBeTruthy();
    expect(total.queryByText('Усього сплачено')).toBeNull();
  });
});

describe.each(['en', 'uk'])('RecurringChargesScreen — no category, in %s', (language) => {
  const NO_CATEGORY: Spec[] = [
    { name: 'Netflix', charges: [299], category: 'subscriptions' },
    { name: 'Gym', charges: [150, 150], category: null },
    { name: 'Yoga', charges: [100], category: '' },
    { name: 'Swim', charges: [50], category: null, noRows: true },
  ];

  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('shows it under the default category heading, never an Uncategorized one', async () => {
    worldOf(NO_CATEGORY);

    const tree = await renderScreen();
    const order = layoutOf(tree);

    expect(order.filter((testId) => /^recurring-charges-group-[^t]/.test(testId))).toEqual([
      'recurring-charges-group-subscriptions',
      'recurring-charges-group-other',
    ]);
    expect(
      within(tree.getByTestId('recurring-charges-group-other')).getByText(
        language === 'uk' ? 'Інше' : 'Other',
      ),
    ).toBeTruthy();
    expect(order.slice(order.indexOf('recurring-charges-group-other'))).toEqual(
      expect.arrayContaining([rowId('Gym'), rowId('Yoga'), rowId('Swim')]),
    );
    expect(tree.queryByText(i18n.t('categories.uncategorized'))).toBeNull();
    expect(tree.queryByText('Uncategorized')).toBeNull();
    expect(tree.queryByText('Без категорії')).toBeNull();
    expect(tree.queryByTestId(/uncategorized/i)).toBeNull();
    expect(
      within(tree.getByTestId('recurring-charges-group-total-other')).getByText(
        moneyText(15000 + 10000 + 5000),
      ),
    ).toBeTruthy();
  });
});

describe('RecurringChargesScreen — sections after the groups', () => {
  const MARKED_EMPTY: MarkedChain = {
    key: 'apple',
    name: 'Apple',
    currency: 'UAH',
    period: 'monthly',
    marks: [{ currency: 'UAH', amountMinorUnits: 9900, period: 'monthly' }],
  };

  const ONE_GROUP: Spec[] = [{ name: 'Netflix', charges: [299], category: 'subscriptions' }];

  const withSections = () =>
    worldOf(ONE_GROUP, {
      withoutCharges: [MARKED_EMPTY],
      choices: new Map([['dropbox', { name: 'Dropbox', hidden: true }]]),
    });

  it('puts "Marked, No Charges" after the groups behind a divider, with nothing for a hidden key after it', async () => {
    withSections();

    const tree = await renderScreen();
    const order = layoutOf(tree);

    expect(order.filter((testId) => testId.startsWith('recurring-charges-divider-'))).toEqual([
      'recurring-charges-divider-group-subscriptions',
      'recurring-charges-divider-heading-markedEmpty',
    ]);
    expect(order.slice(order.indexOf(rowId('Netflix')) + 1)).toEqual([
      'recurring-charges-divider-heading-markedEmpty',
      'recurring-charges-heading-marked-empty',
      expect.stringMatching(/^recurring-charges-marked-empty-/),
    ]);
  });

  it('shows no total in "Marked, No Charges"', async () => {
    withSections();

    const { getByTestId, getAllByTestId } = await renderScreen();

    expect(getAllByTestId(/^recurring-charges-(group-)?total/)).toHaveLength(2);
    expect(
      within(getByTestId('recurring-charges-heading-marked-empty')).queryByText(/\d/),
    ).toBeNull();
  });
});

describe.each(['en', 'uk'])(
  'RecurringChargesScreen — a hidden key and the totals, in %s',
  (language) => {
    const SPOTIFY_AND_NETFLIX: Spec[] = [
      { name: 'Netflix', charges: [299, 299], category: 'subscriptions' },
      { name: 'Spotify', charges: [99, 99], category: 'subscriptions' },
      { name: 'Power', charges: [300], category: 'utilities' },
    ];

    const HIDDEN_SPOTIFY = new Map([['spotify', { name: 'Spotify', hidden: true as const }]]);

    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage(language);
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('counts the amounts of a hidden key in no group total and not in the total of all', async () => {
      worldOf(SPOTIFY_AND_NETFLIX, { choices: HIDDEN_SPOTIFY });

      const { getByTestId, queryByText, queryByTestId } = await renderScreen();

      expect(
        within(getByTestId('recurring-charges-total')).getByText(moneyText(30000 + 29900)),
      ).toBeTruthy();
      expect(
        within(getByTestId('recurring-charges-group-total-subscriptions')).getByText(
          moneyText(29900),
        ),
      ).toBeTruthy();
      expect(queryByText(moneyText(9900))).toBeNull();
      expect(queryByText(moneyText(30000 + 29900 + 9900))).toBeNull();
      expect(queryByText(moneyText(29900 + 9900))).toBeNull();
      expect(queryByTestId(rowId('Spotify'))).toBeNull();
    });

    it('counts them again when the key is not hidden, which the hidden totals are the twin of', async () => {
      worldOf(SPOTIFY_AND_NETFLIX);

      const { getByTestId } = await renderScreen();

      expect(
        within(getByTestId('recurring-charges-total')).getByText(moneyText(30000 + 29900 + 9900)),
      ).toBeTruthy();
      expect(
        within(getByTestId('recurring-charges-group-total-subscriptions')).getByText(
          moneyText(29900 + 9900),
        ),
      ).toBeTruthy();
    });

    it('lists and counts the marked series of a hidden key, and not its detected one', async () => {
      const detected = seriesOf({ name: 'Dropbox', charges: [999], category: 'subscriptions' });
      const marked: RecurringSeries = {
        ...seriesOf({ name: 'Dropbox', charges: [150], category: 'subscriptions' }),
        id: 'dropbox-marked',
        chargeIds: ['dropbox-marked-0'],
        recurrence: { kind: 'marked' },
        marks: [{ currency: 'UAH', amountMinorUnits: 15000, period: 'monthly' }],
      };

      mockSeriesState = {
        ...EMPTY_STATE,
        series: [detected],
        markedSeries: [marked],
        choices: new Map([['dropbox', { name: 'Dropbox', hidden: true }]]),
      };
      mockRows = [
        {
          id: 'dropbox-marked-0',
          amountMinorUnits: -15000,
          currency: 'UAH',
          category: 'subscriptions',
        },
      ];

      const { getByTestId, queryByTestId, queryByText } = await renderScreen();

      expect(getByTestId('recurring-series-row-dropbox-marked')).toBeTruthy();
      expect(queryByTestId(rowId('Dropbox'))).toBeNull();
      expect(
        within(getByTestId('recurring-charges-group-total-subscriptions')).getByText(
          moneyText(15000),
        ),
      ).toBeTruthy();
      expect(queryByText(moneyText(99900))).toBeNull();
    });
  },
);

describe('RecurringChargesScreen — loading and empty', () => {
  it('shows the loading state, no groups and no total, while the groups are read', async () => {
    worldOf(TWO_GROUPS);
    mockGroupsOverride = { groups: [], total: undefined, isLoading: true };

    const tree = await renderScreen();

    expect(tree.getByTestId('recurring-charges-loading')).toBeTruthy();
    expect(tree.queryByTestId('recurring-charges-empty')).toBeNull();
    expect(layoutOf(tree)).toEqual([]);
  });

  it('shows the loading state while the series are read, with the groups settled', async () => {
    worldOf(TWO_GROUPS, { isLoading: true });

    const tree = await renderScreen();

    expect(tree.getByTestId('recurring-charges-loading')).toBeTruthy();
    expect(layoutOf(tree)).toEqual([]);
  });

  it('shows the empty state and no total row with no series', async () => {
    worldOf([]);

    const tree = await renderScreen();

    expect(tree.getByTestId('recurring-charges-empty')).toBeTruthy();
    expect(tree.queryByTestId('recurring-charges-total')).toBeNull();
    expect(tree.queryByTestId(/^recurring-charges-group-/)).toBeNull();
  });
});
