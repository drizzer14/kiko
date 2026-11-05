import { Alert } from 'react-native';
import { i18n } from '@kiko/i18n/init';
import {
  type SettingsRows,
  BANK,
  CARD,
  DOLLAR_CARD,
  RISING_CHAIN,
  STORED_AT_99,
  STORED_AT_100,
  TWO_CHAINS,
  chargeRowOf,
  createMarkLiveQueries,
  markOf,
  markWrites as mockWrites,
  netflixSettingsOf,
  settingsModuleWith as mockSettingsModuleWith,
  settingsRowsOf,
  taggedQuery as mockTaggedQuery,
} from '@kiko/test-support/recurring-mark-live-queries';
import type { ComponentType, ReactElement } from 'react';
import type { RecurringLedgerRow } from '@kiko/recurring/detection';
import { RECURRING_PERIODS } from '@kiko/recurring/recurring-periods';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';

const mockLive = createMarkLiveQueries();
const { landSettings, landLedger } = mockLive;
const { markRecurringCharge, setRecurringChainPeriod, removeRecurringMarks } = mockWrites;

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }, tables: string[], enabled?: boolean) =>
    mockLive.answer(query, tables, enabled) ?? { data: [], isLoading: false, isFresh: true },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { recurringLedgerQuery: () => mockTaggedQuery('recurringLedger') },
}));
jest.mock('@kiko/settings', () => mockSettingsModuleWith(mockWrites.repo));

type FieldProps = {
  existing: RecurringLedgerRow;
  holdings: (typeof CARD)[];
  accounts: (typeof BANK)[];
};
type World = {
  settingsRows: SettingsRows;
  ledger: RecurringLedgerRow[];
  amount: number;
  description?: string;
  holdingId?: string;
};
type WriteCase = {
  name: string;
  world: World;
  option: string;
  write: () => jest.Mock;
  shownAfter: string;
};

const HOLDINGS = [CARD, DOLLAR_CARD];
const ACCOUNTS = [BANK];
const NOT_MARKED = 'Not marked';
const FIELD_LABEL = 'Mark as recurring';
const NOTHING_STORED: SettingsRows = [];
const HIDDEN_KEY = netflixSettingsOf({ hidden: true });
const PERIOD_LABELS = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  everyThreeMonths: 'Every 3 months',
  everySixMonths: 'Every 6 months',
  yearly: 'Yearly',
};
const WRITE_FAILED = new Error('write failed');
const YEARLY_AT_100 = markOf('yearly', 10_000);

// A row of 100 beside a stored 100, a row of 144 in that chain, a 399 beside a stored 99, and a row
// under a name with nothing stored.
const INSIDE_CHAIN: World = { settingsRows: STORED_AT_100, ledger: RISING_CHAIN, amount: -10_000 };
const RISING_ROW: World = { settingsRows: STORED_AT_100, ledger: RISING_CHAIN, amount: -14_400 };
const OTHER_CHAIN: World = { settingsRows: STORED_AT_99, ledger: TWO_CHAINS, amount: -39_900 };
const UNMARKED: World = { settingsRows: NOTHING_STORED, ledger: RISING_CHAIN, amount: -14_400 };
const HIDDEN: World = { ...UNMARKED, settingsRows: HIDDEN_KEY };

const asConstructor = (ledger: RecurringLedgerRow[]): RecurringLedgerRow[] =>
  ledger.map((row) => ({ ...row, description: 'constructor' }));

// Reached at run time, so the suite loads and each pin fails on its own while the field is missing.
const fieldComponent = (): ComponentType<FieldProps> =>
  (jest.requireActual('.') as { default: ComponentType<FieldProps> }).default;

const fieldOf = ({
  amount,
  description = 'Netflix 4412',
  holdingId = 'card',
}: Pick<World, 'amount' | 'description' | 'holdingId'>): ReactElement => {
  const Field = fieldComponent();

  return (
    <Field
      existing={chargeRowOf('stored', 0, amount, { description, holdingId, source: 'manual' })}
      holdings={HOLDINGS}
      accounts={ACCOUNTS}
    />
  );
};

const showField = async (world: World) => {
  landSettings(world.settingsRows);
  landLedger(world.ledger);

  return render(fieldOf(world));
};

type Rendered = Awaited<ReturnType<typeof showField>>;

const isDisabled = (rendered: Rendered): boolean =>
  rendered.getByLabelText(FIELD_LABEL).props.accessibilityState.disabled;

const pick = async (rendered: Rendered, label: string): Promise<void> => {
  await fireEvent.press(rendered.getByLabelText(FIELD_LABEL));
  await fireEvent.press(rendered.getByLabelText(label));
};

beforeEach(() => {
  mockLive.reset();
  mockWrites.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RecurringMarkField', () => {
  describe('labels', () => {
    it('shows the field label, and the sheet title once it opens', async () => {
      const rendered = await showField(UNMARKED);

      expect(rendered.getByText(FIELD_LABEL)).toBeTruthy();
      expect(rendered.queryByText('Mark as Recurring')).toBeNull();

      await fireEvent.press(rendered.getByLabelText(FIELD_LABEL));

      expect(rendered.getByText('Mark as Recurring')).toBeTruthy();
    });

    it('lists "Not marked" and the five periods in the picker order', async () => {
      const rendered = await showField(UNMARKED);
      const labels = [NOT_MARKED, ...RECURRING_PERIODS.map((period) => PERIOD_LABELS[period])];

      await fireEvent.press(rendered.getByLabelText(FIELD_LABEL));

      expect(
        rendered
          .getAllByLabelText(new RegExp(`^(${labels.join('|')})$`))
          .map((row) => row.props.accessibilityLabel),
      ).toEqual(labels);
    });
  });

  describe('under the uk language', () => {
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

    it('reads the label and the value in Ukrainian', async () => {
      const rendered = await showField(UNMARKED);

      expect(rendered.getByText('Позначити як регулярний')).toBeTruthy();
      expect(rendered.getByText('Не позначено')).toBeTruthy();
    });

    it('reads a period in Ukrainian', async () => {
      const rendered = await showField(RISING_ROW);

      expect(rendered.getByText('Щороку')).toBeTruthy();
    });
  });

  describe('the value', () => {
    it.each(RECURRING_PERIODS)('shows %s for a row in a chain marked with it', async (period) => {
      const rendered = await showField({
        ...INSIDE_CHAIN,
        settingsRows: netflixSettingsOf({ marks: [markOf(period, 10_000)] }),
      });

      expect(rendered.getByText(PERIOD_LABELS[period])).toBeTruthy();
      expect(rendered.queryByText(NOT_MARKED)).toBeNull();
    });

    it.each([
      ['a row under a name with no mark', UNMARKED],
      ['a row of 399 beside a stored 99', OTHER_CHAIN],
      ['a hidden key with no mark', HIDDEN],
      [
        'a key that names a plain-object member, with no choice',
        { ...UNMARKED, description: 'constructor', ledger: asConstructor(RISING_CHAIN) },
      ],
    ])('shows "Not marked" and stays enabled for %s', async (_title, world) => {
      const rendered = await showField(world);

      expect(rendered.getByText(NOT_MARKED)).toBeTruthy();
      expect(isDisabled(rendered)).toBe(false);
    });

    it('shows the period of a row of 144 beside a stored 100', async () => {
      const rendered = await showField(RISING_ROW);

      expect(rendered.getByText(PERIOD_LABELS.yearly)).toBeTruthy();
    });

    it('shows the period of a choice stored under the plain-object member name', async () => {
      const rendered = await showField({
        settingsRows: settingsRowsOf('constructor', {
          name: 'constructor',
          marks: [YEARLY_AT_100],
        }),
        ledger: asConstructor(RISING_CHAIN),
        description: 'constructor',
        amount: -10_000,
      });

      expect(rendered.getByText(PERIOD_LABELS.yearly)).toBeTruthy();
    });
  });

  describe('a pick', () => {
    it('marks a row in no marked chain with its key, spelling, absolute amount and currency', async () => {
      const rendered = await showField(UNMARKED);

      await pick(rendered, PERIOD_LABELS.monthly);

      expect(markRecurringCharge).toHaveBeenCalledTimes(1);
      expect(markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
        currency: 'UAH',
        amountMinorUnits: 14_400,
        period: 'monthly',
      });
      expect(setRecurringChainPeriod).not.toHaveBeenCalled();
      expect(removeRecurringMarks).not.toHaveBeenCalled();
    });

    it('adds a mark beside the stored 99 on a row of 399', async () => {
      const rendered = await showField(OTHER_CHAIN);

      await pick(rendered, PERIOD_LABELS.weekly);

      expect(markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
        currency: 'UAH',
        amountMinorUnits: 39_900,
        period: 'weekly',
      });
      expect(setRecurringChainPeriod).not.toHaveBeenCalled();
    });

    it.each([
      ['a row of the stored amount', INSIDE_CHAIN],
      ['a row of 144 beside a stored 100, with no new mark', RISING_ROW],
    ])('rewrites the period of the chain on %s', async (_title, world) => {
      const rendered = await showField(world);

      await pick(rendered, PERIOD_LABELS.monthly);

      expect(setRecurringChainPeriod).toHaveBeenCalledTimes(1);
      expect(setRecurringChainPeriod).toHaveBeenCalledWith('netflix', [YEARLY_AT_100], 'monthly');
      expect(markRecurringCharge).not.toHaveBeenCalled();
      expect(removeRecurringMarks).not.toHaveBeenCalled();
    });

    it('removes the marks of the chain with "Not marked"', async () => {
      const rendered = await showField(RISING_ROW);

      await pick(rendered, NOT_MARKED);

      expect(removeRecurringMarks).toHaveBeenCalledTimes(1);
      expect(removeRecurringMarks).toHaveBeenCalledWith('netflix', [YEARLY_AT_100]);
      expect(markRecurringCharge).not.toHaveBeenCalled();
      expect(setRecurringChainPeriod).not.toHaveBeenCalled();
    });

    it.each([
      ['a row of another chain', OTHER_CHAIN],
      ['a hidden key, which keeps its hide', HIDDEN],
    ])('writes nothing with "Not marked" on %s', async (_title, world) => {
      const rendered = await showField(world);

      await pick(rendered, NOT_MARKED);

      expect(mockWrites.every.flatMap((write) => write.mock.calls)).toEqual([]);
    });

    it.each([
      ['a USD row', 'dollar-card', 'USD'],
      ['a UAH row', 'card', 'UAH'],
    ])('stores the currency of the holding of %s', async (_title, holdingId, currency) => {
      const rendered = await showField({ ...UNMARKED, holdingId });

      await pick(rendered, PERIOD_LABELS.yearly);

      expect(markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
        currency,
        amountMinorUnits: 14_400,
        period: 'yearly',
      });
    });
  });

  describe('while it cannot tell the value', () => {
    const WRITES: WriteCase[] = [
      {
        name: 'markRecurringCharge',
        world: UNMARKED,
        option: PERIOD_LABELS.monthly,
        write: () => markRecurringCharge,
        shownAfter: NOT_MARKED,
      },
      {
        name: 'setRecurringChainPeriod',
        world: INSIDE_CHAIN,
        option: PERIOD_LABELS.monthly,
        write: () => setRecurringChainPeriod,
        shownAfter: PERIOD_LABELS.yearly,
      },
      {
        name: 'removeRecurringMarks',
        world: INSIDE_CHAIN,
        option: NOT_MARKED,
        write: () => removeRecurringMarks,
        shownAfter: PERIOD_LABELS.yearly,
      },
    ];

    it('is disabled with no value while the settings read loads, and released when it lands', async () => {
      mockLive.reads.settings = { rows: STORED_AT_100, isLoading: true, error: undefined };
      landLedger(RISING_CHAIN);

      const rendered = await render(fieldOf(INSIDE_CHAIN));

      expect(isDisabled(rendered)).toBe(true);
      expect(rendered.queryByText(NOT_MARKED)).toBeNull();
      expect(rendered.queryByText(PERIOD_LABELS.yearly)).toBeNull();

      landSettings(STORED_AT_100);
      await act(async () => {
        await rendered.rerender(fieldOf(INSIDE_CHAIN));
      });

      expect(isDisabled(rendered)).toBe(false);
      expect(rendered.getByText(PERIOD_LABELS.yearly)).toBeTruthy();
    });

    it.each(WRITES)(
      'is disabled with no value during the $name write, and released once it settles',
      async ({ world, option, write, shownAfter }) => {
        let settle: () => void = () => undefined;

        write().mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));

        const rendered = await showField(world);

        await pick(rendered, option);

        expect(isDisabled(rendered)).toBe(true);
        expect(rendered.queryByText(NOT_MARKED)).toBeNull();
        expect(rendered.queryByText(PERIOD_LABELS.yearly)).toBeNull();

        await act(async () => settle());

        expect(isDisabled(rendered)).toBe(false);
        expect(rendered.getByText(shownAfter)).toBeTruthy();
      },
    );

    it.each(WRITES)('shows the save alert when $name rejects', async ({ world, option, write }) => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      write().mockRejectedValue(WRITE_FAILED);

      const rendered = await showField(world);

      await pick(rendered, option);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          i18n.t('forms.fields.saveErrorTitle'),
          i18n.t('forms.fields.saveErrorMessage'),
        ),
      );
      expect(isDisabled(rendered)).toBe(false);
    });

    it.each(WRITES)('shows no alert when $name resolves', async ({ world, option, write }) => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const rendered = await showField(world);

      await pick(rendered, option);

      expect(write()).toHaveBeenCalledTimes(1);
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });
});
