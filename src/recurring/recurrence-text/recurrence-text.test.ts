import { i18n } from '@kiko/i18n/init';
import { formatDate, formatDayMonth } from '@kiko/dates';
import type { Recurrence, RecurringPeriod, RecurringSeries } from '@kiko/recurring/detection';

import { lastChargeLine, recurrenceLine } from './recurrence-text';

const recurrenceLineOf = (period: RecurringPeriod, recurrence: Recurrence): string =>
  recurrenceLine(period, recurrence, i18n.t);

const lastChargeLineOf = (series: RecurringSeries): string => lastChargeLine(series, i18n.t);

const LAST_CHARGE_TIME = new Date(2026, 7, 15, 9, 30).getTime();
const QUIET_SINCE = new Date(2026, 7, 20, 18, 5).getTime();
const YEARLY_TIME = new Date(2025, 2, 7, 12, 0).getTime();

const seriesWith = (overrides: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'series-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: ['charge-3', 'charge-2', 'charge-1'],
  lastChargeTime: LAST_CHARGE_TIME,
  lastChargeAmountMinorUnits: 29900,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
  ...overrides,
});

// Sunday first, as `Date.prototype.getDay` numbers a weekday.
const WEEKDAY_LINES_EN = [
  'Weekly, on Sundays',
  'Weekly, on Mondays',
  'Weekly, on Tuesdays',
  'Weekly, on Wednesdays',
  'Weekly, on Thursdays',
  'Weekly, on Fridays',
  'Weekly, on Saturdays',
];

const WEEKDAY_LINES_UK = [
  'Щотижня, у неділю',
  'Щотижня, у понеділок',
  'Щотижня, у вівторок',
  'Щотижня, у середу',
  'Щотижня, у четвер',
  'Щотижня, у пʼятницю',
  'Щотижня, у суботу',
];

const MARKED: Recurrence = { kind: 'marked' };

const markedSeriesWith = (period: RecurringPeriod): RecurringSeries => {
  const markedFields = {
    marks: [{ currency: 'UAH' as const, amountMinorUnits: 88800, period }],
    markedSpan: { lowest: 88800, highest: 99900 },
  };

  return { ...seriesWith({ period, recurrence: MARKED }), ...markedFields };
};

const MARKED_PERIODS: readonly RecurringPeriod[] = [
  'weekly',
  'monthly',
  'everyThreeMonths',
  'everySixMonths',
  'yearly',
];
const MARKED_ONLY_PERIODS: readonly RecurringPeriod[] = ['everyThreeMonths', 'everySixMonths'];

const MARKED_LINES_EN = [
  'Marked: weekly',
  'Marked: monthly',
  'Marked: every 3 months',
  'Marked: every 6 months',
  'Marked: yearly',
];

const MARKED_LINES_UK = [
  'Позначено: щотижня',
  'Позначено: щомісяця',
  'Позначено: раз на 3 місяці',
  'Позначено: раз на 6 місяців',
  'Позначено: щороку',
];

type MarkedExpectations = {
  lines: readonly string[];
  monthlyOnDay: string;
  weeklyOnMonday: string;
  yearlyOn: string;
  monthly: string;
  emptyMessage: string;
  lastCharge: string;
  quiet: string;
};

const markedCases = (expected: MarkedExpectations): void => {
  describe('marked text', () => {
    it.each(MARKED_PERIODS.map((period, index) => [period, expected.lines[index]] as const))(
      'reads a marked %s series as its marked line',
      (period, line) => {
        expect(recurrenceLineOf(period, MARKED)).toBe(line);
      },
    );

    it.each(MARKED_ONLY_PERIODS.map((period) => [period, MARKED_PERIODS.indexOf(period)] as const))(
      'reads a %s period with no pattern as its marked line',
      (period, index) => {
        expect(recurrenceLineOf(period, { kind: 'none' })).toBe(expected.lines[index]);
        expect(recurrenceLineOf('monthly', { kind: 'none' })).toBe(expected.monthly);
      },
    );

    it('reads a marked monthly day as any series', () => {
      const line = recurrenceLineOf('monthly', { kind: 'onDay', day: 15 });

      expect(line).toBe(expected.monthlyOnDay);
      expect(expected.lines).not.toContain(line);
      expect(recurrenceLineOf('monthly', MARKED)).toBe(expected.lines[1]);
    });

    it('reads a marked weekday and a marked date as any series', () => {
      expect(recurrenceLineOf('weekly', { kind: 'onWeekday', weekday: 1 })).toBe(
        expected.weeklyOnMonday,
      );
      expect(recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME })).toBe(
        expected.yearlyOn,
      );
      expect(recurrenceLineOf('weekly', MARKED)).toBe(expected.lines[0]);
    });

    it('words the empty message with no merchant name', () => {
      const text = i18n.t('recurringCharges.markedEmptyMessage', { name: 'Netflix' });

      expect(text).toBe(expected.emptyMessage);
      expect(text).not.toContain('Netflix');
      expect(text).not.toContain('{{');
    });

    it('words the empty message with no digit', () => {
      const text = i18n.t('recurringCharges.markedEmptyMessage');

      expect(text).toBe(expected.emptyMessage);
      expect(text).not.toMatch(/\d/);
    });

    it('would show a merchant name and a digit if the message held them', () => {
      const text = i18n.t('recurringCharges.holdingQuietSince', {
        holding: 'Netflix',
        date: formatDate(QUIET_SINCE),
      });

      expect(text).toBe(expected.quiet);
      expect(text).toContain('Netflix');
      expect(text).toMatch(/\d/);
    });

    it('holds the last real charge of a marked series, never a stored amount', () => {
      const line = lastChargeLineOf(markedSeriesWith('everyThreeMonths'));

      expect(line).toBe(expected.lastCharge);
      expect(line).not.toContain('888');
      expect(recurrenceLineOf('everyThreeMonths', MARKED)).toBe(expected.lines[2]);
    });
  });
};

describe('recurrence text in English', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  markedCases({
    lines: MARKED_LINES_EN,
    monthlyOnDay: 'Monthly, on day 15',
    weeklyOnMonday: 'Weekly, on Mondays',
    yearlyOn: 'Yearly, on 07.03',
    monthly: 'Monthly',
    emptyMessage:
      'No transactions near the amount you marked count here now. ' +
      'Transfers, exchanges and loan payments are left out.',
    lastCharge: 'Last charge 15.08.2026',
    quiet: '"Netflix": no newer transactions since 20.08.2026',
  });

  describe('recurrenceLine', () => {
    it.each<[string, RecurringPeriod, Recurrence, string]>([
      ['a monthly day', 'monthly', { kind: 'onDay', day: 15 }, 'Monthly, on day 15'],
      ['a monthly day near', 'monthly', { kind: 'aroundDay', day: 12 }, 'Monthly, around day 12'],
      ['the last day', 'monthly', { kind: 'lastDay' }, 'Monthly, on the last day'],
      ['a monthly series with no pattern', 'monthly', { kind: 'none' }, 'Monthly'],
      ['a weekly series with no pattern', 'weekly', { kind: 'none' }, 'Weekly'],
      ['a yearly series with no pattern', 'yearly', { kind: 'none' }, 'Yearly'],
    ])('reads %s', (_name, period, recurrence, expected) => {
      expect(recurrenceLineOf(period, recurrence)).toBe(expected);
    });

    it.each(WEEKDAY_LINES_EN.map((line, weekday) => [weekday, line] as const))(
      'reads weekday %i on a weekly series',
      (weekday, expected) => {
        expect(recurrenceLineOf('weekly', { kind: 'onWeekday', weekday })).toBe(expected);
      },
    );

    it('reads a yearly date as day and month', () => {
      expect(formatDayMonth(YEARLY_TIME)).toBe('07.03');
      expect(recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME })).toBe(
        'Yearly, on 07.03',
      );
    });

    it('never says Charged on a recurrence line', () => {
      const lines = [
        recurrenceLineOf('monthly', { kind: 'onDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'aroundDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'lastDay' }),
        recurrenceLineOf('monthly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'onWeekday', weekday: 3 }),
        recurrenceLineOf('yearly', { kind: 'none' }),
        recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME }),
      ];

      expect(lines).toHaveLength(8);
      expect(lines.some((line) => line.includes('Charged'))).toBe(false);
    });

    it('labels the total of a series', () => {
      expect(i18n.getResource('en', 'translation', 'recurringCharges.paidSoFar')).toBe(
        'All paid so far',
      );
    });
  });

  describe('lastChargeLine', () => {
    it('names the last charge date of an active series', () => {
      expect(formatDate(LAST_CHARGE_TIME)).toBe('15.08.2026');
      expect(lastChargeLineOf(seriesWith({}))).toBe('Last charge 15.08.2026');
    });

    it('says no charge since the last charge date of a stopped series', () => {
      expect(lastChargeLineOf(seriesWith({ isStopped: true }))).toBe('No charge since 15.08.2026');
    });

    it('names the holding and its newest date when the series is quiet', () => {
      expect(formatDate(QUIET_SINCE)).toBe('20.08.2026');
      expect(
        lastChargeLineOf(
          seriesWith({
            isStopped: true,
            quiet: { since: QUIET_SINCE, holdingName: 'Monobank black' },
          }),
        ),
      ).toBe('"Monobank black": no newer transactions since 20.08.2026');
    });

    it('reads the quiet date, never the charge date', () => {
      const line = lastChargeLineOf(
        seriesWith({ isStopped: true, quiet: { since: QUIET_SINCE, holdingName: '*1234' } }),
      );

      expect(line).toBe('"*1234": no newer transactions since 20.08.2026');
      expect(line).not.toContain('15.08.2026');
    });
  });
});

describe('recurrence text in Ukrainian', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('uk');
  });

  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  markedCases({
    lines: MARKED_LINES_UK,
    monthlyOnDay: 'Щомісяця, 15 числа',
    weeklyOnMonday: 'Щотижня, у понеділок',
    yearlyOn: 'Щороку, 07.03',
    monthly: 'Щомісяця',
    emptyMessage:
      'Зараз тут немає транзакцій, близьких до позначеної суми, які враховуються. ' +
      'Перекази, обміни й платежі за кредитом не враховуються.',
    lastCharge: 'Останнє списання 15.08.2026',
    quiet: '«Netflix»: немає новіших транзакцій за 20.08.2026',
  });

  describe('recurrenceLine', () => {
    it.each<[string, RecurringPeriod, Recurrence, string]>([
      ['a monthly day', 'monthly', { kind: 'onDay', day: 15 }, 'Щомісяця, 15 числа'],
      [
        'a monthly day near',
        'monthly',
        { kind: 'aroundDay', day: 12 },
        'Щомісяця, близько 12 числа',
      ],
      ['the last day', 'monthly', { kind: 'lastDay' }, 'Щомісяця, в останній день'],
      ['a monthly series with no pattern', 'monthly', { kind: 'none' }, 'Щомісяця'],
      ['a weekly series with no pattern', 'weekly', { kind: 'none' }, 'Щотижня'],
      ['a yearly series with no pattern', 'yearly', { kind: 'none' }, 'Щороку'],
    ])('reads %s', (_name, period, recurrence, expected) => {
      expect(recurrenceLineOf(period, recurrence)).toBe(expected);
    });

    it.each(WEEKDAY_LINES_UK.map((line, weekday) => [weekday, line] as const))(
      'reads weekday %i in the accusative',
      (weekday, expected) => {
        expect(recurrenceLineOf('weekly', { kind: 'onWeekday', weekday })).toBe(expected);
      },
    );

    it('spells Friday with the modifier letter apostrophe', () => {
      const line = recurrenceLineOf('weekly', { kind: 'onWeekday', weekday: 5 });

      expect(line).toBe('Щотижня, у пʼятницю');
      expect(line).toContain('ʼ');
      expect(line).not.toContain("'");
    });

    it('reads a yearly date as day and month', () => {
      expect(recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME })).toBe(
        'Щороку, 07.03',
      );
    });

    it('names only the rhythm, with no Списувалося and no Списання', () => {
      const lines = [
        recurrenceLineOf('monthly', { kind: 'onDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'aroundDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'lastDay' }),
        recurrenceLineOf('monthly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'onWeekday', weekday: 3 }),
        recurrenceLineOf('yearly', { kind: 'none' }),
        recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME }),
      ];

      expect(lines).toHaveLength(8);
      expect(lines.some((line) => line.includes('Списувалося'))).toBe(false);
      expect(lines.some((line) => line.startsWith('Списання'))).toBe(false);
    });

    it('labels the total of a series', () => {
      expect(i18n.getResource('uk', 'translation', 'recurringCharges.paidSoFar')).toBe(
        'Усього сплачено',
      );
    });
  });

  describe('lastChargeLine', () => {
    it('names the last charge date of an active series', () => {
      expect(lastChargeLineOf(seriesWith({}))).toBe('Останнє списання 15.08.2026');
    });

    it('says no charge since the last charge date of a stopped series', () => {
      expect(lastChargeLineOf(seriesWith({ isStopped: true }))).toBe('Немає списань з 15.08.2026');
    });

    it('names the holding and its newest date when the series is quiet', () => {
      expect(
        lastChargeLineOf(
          seriesWith({
            isStopped: true,
            quiet: { since: QUIET_SINCE, holdingName: 'Monobank black' },
          }),
        ),
      ).toBe('«Monobank black»: немає новіших транзакцій за 20.08.2026');
    });

    it('keeps the guillemets around the quiet holding name, never straight quotes', () => {
      const line = lastChargeLineOf(
        seriesWith({ isStopped: true, quiet: { since: QUIET_SINCE, holdingName: 'Wallet' } }),
      );

      expect(line.startsWith('«Wallet»: ')).toBe(true);
      expect(line).not.toContain('"');
    });
  });
});
