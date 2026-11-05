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
  'Charged weekly, on Sundays',
  'Charged weekly, on Mondays',
  'Charged weekly, on Tuesdays',
  'Charged weekly, on Wednesdays',
  'Charged weekly, on Thursdays',
  'Charged weekly, on Fridays',
  'Charged weekly, on Saturdays',
];

const WEEKDAY_LINES_UK = [
  'Списувалося щотижня, у неділю',
  'Списувалося щотижня, у понеділок',
  'Списувалося щотижня, у вівторок',
  'Списувалося щотижня, у середу',
  'Списувалося щотижня, у четвер',
  'Списувалося щотижня, у пʼятницю',
  'Списувалося щотижня, у суботу',
];

describe('recurrence text in English', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  describe('recurrenceLine', () => {
    it.each<[string, RecurringPeriod, Recurrence, string]>([
      ['a monthly day', 'monthly', { kind: 'onDay', day: 15 }, 'Charged monthly, on day 15'],
      [
        'a monthly day near',
        'monthly',
        { kind: 'aroundDay', day: 12 },
        'Charged monthly, around day 12',
      ],
      ['the last day', 'monthly', { kind: 'lastDay' }, 'Charged monthly, on the last day'],
      ['a monthly series with no pattern', 'monthly', { kind: 'none' }, 'Charged monthly'],
      ['a weekly series with no pattern', 'weekly', { kind: 'none' }, 'Charged weekly'],
      ['a yearly series with no pattern', 'yearly', { kind: 'none' }, 'Charged yearly'],
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
        'Charged yearly, on 07.03',
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
      ).toBe('Monobank black: no newer transactions since 20.08.2026');
    });

    it('reads the quiet date, never the charge date', () => {
      const line = lastChargeLineOf(
        seriesWith({ isStopped: true, quiet: { since: QUIET_SINCE, holdingName: '*1234' } }),
      );

      expect(line).toBe('*1234: no newer transactions since 20.08.2026');
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

  describe('recurrenceLine', () => {
    it.each<[string, RecurringPeriod, Recurrence, string]>([
      ['a monthly day', 'monthly', { kind: 'onDay', day: 15 }, 'Списувалося щомісяця, 15 числа'],
      [
        'a monthly day near',
        'monthly',
        { kind: 'aroundDay', day: 12 },
        'Списувалося щомісяця, близько 12 числа',
      ],
      ['the last day', 'monthly', { kind: 'lastDay' }, 'Списувалося щомісяця, в останній день'],
      ['a monthly series with no pattern', 'monthly', { kind: 'none' }, 'Списувалося щомісяця'],
      ['a weekly series with no pattern', 'weekly', { kind: 'none' }, 'Списувалося щотижня'],
      ['a yearly series with no pattern', 'yearly', { kind: 'none' }, 'Списувалося щороку'],
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

      expect(line).toBe('Списувалося щотижня, у пʼятницю');
      expect(line).toContain('ʼ');
      expect(line).not.toContain("'");
    });

    it('reads a yearly date as day and month', () => {
      expect(recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME })).toBe(
        'Списувалося щороку, 07.03',
      );
    });

    it('opens every line in the past frame, never with Списання', () => {
      const lines = [
        recurrenceLineOf('monthly', { kind: 'onDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'aroundDay', day: 1 }),
        recurrenceLineOf('monthly', { kind: 'lastDay' }),
        recurrenceLineOf('monthly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'none' }),
        recurrenceLineOf('weekly', { kind: 'onWeekday', weekday: 3 }),
        recurrenceLineOf('yearly', { kind: 'onDate', time: YEARLY_TIME }),
      ];

      expect(lines).toHaveLength(7);
      expect(lines.every((line) => line.startsWith('Списувалося '))).toBe(true);
      expect(lines.some((line) => line.startsWith('Списання'))).toBe(false);
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
  });
});
