import { i18n } from '@kiko/i18n/init';
import maybe, { foldMap } from 'fnts/maybe';
import type { PlannedRequest } from '@kiko/reminders/planner';

import { reminderContent } from '.';

const ACCOUNT_NAME = 'Mono Black';

// The account's name stands in for every identifier, so a leak of any of
// them into the text shows up as the name.
const request = (overrides: Partial<PlannedRequest> = {}): PlannedRequest => ({
  identifier: `kiko.reminder.${ACCOUNT_NAME}.202610012000`,
  reminderId: ACCOUNT_NAME,
  accountId: ACCOUNT_NAME,
  kind: 'statement_import',
  fireAt: { year: 2026, month: 10, day: 1, hour: 20, minute: 0 },
  variant: 'reminder',
  daysSinceData: 9,
  ...overrides,
});

const english = i18n.getFixedT('en');
const ukrainian = i18n.getFixedT('uk');

describe('reminderContent — reminders', () => {
  it('describes the days since the last statement import, as an active notification', () => {
    expect(reminderContent(request(), english)).toEqual({
      title: 'Statement import',
      body: '9 days since your last statement import.',
      interruptionLevel: 'active',
      threadIdentifier: 'statement_import',
    });
  });

  it('describes the days since a transaction was last added', () => {
    expect(reminderContent(request({ kind: 'add_transactions' }), english)).toEqual({
      title: 'Transactions',
      body: '9 days since you last added a transaction.',
      interruptionLevel: 'active',
      threadIdentifier: 'add_transactions',
    });
  });

  it.each([
    { count: 0, body: '0 days since your last statement import.' },
    { count: 1, body: '1 day since your last statement import.' },
    { count: 21, body: '21 days since your last statement import.' },
  ])('uses the English plural for $count', ({ count, body }) => {
    expect(reminderContent(request({ daysSinceData: count }), english).body).toBe(body);
  });

  it.each([
    { count: 1, body: '1 день від останнього імпорту виписки.' },
    { count: 2, body: '2 дні від останнього імпорту виписки.' },
    { count: 5, body: '5 днів від останнього імпорту виписки.' },
    { count: 21, body: '21 день від останнього імпорту виписки.' },
  ])('uses the Ukrainian plural for $count', ({ count, body }) => {
    expect(reminderContent(request({ daysSinceData: count }), ukrainian).body).toBe(body);
  });

  it('uses the Ukrainian plural for transactions too', () => {
    const content = reminderContent(
      request({ kind: 'add_transactions', daysSinceData: 2 }),
      ukrainian,
    );

    expect(content).toMatchObject({
      title: 'Транзакції',
      body: '2 дні відтоді, як ви востаннє додали транзакцію.',
    });
  });

  it('says no transactions were added yet when there is no data', () => {
    const noData = request({ kind: 'add_transactions', daysSinceData: null });

    expect(reminderContent(noData, english).body).toBe('No transactions added yet.');
    expect(reminderContent(noData, ukrainian).body).toBe('Жодної транзакції ще не додано.');
  });

  it('says no statements were imported yet when there is no data', () => {
    const noData = request({ daysSinceData: null });

    expect(reminderContent(noData, english).body).toBe('No statements imported yet.');
    expect(reminderContent(noData, ukrainian).body).toBe('Жодної виписки ще не імпортовано.');
  });
});

describe('reminderContent — the paused notice', () => {
  it.each(['statement_import', 'add_transactions'] as const)(
    'uses the paused title and body, as a passive notification (%s)',
    (kind) => {
      const notice = request({ kind, variant: 'pausedNotice' });

      expect(reminderContent(notice, english)).toEqual({
        title: 'Reminders paused',
        body: 'Turn them on again in Kiko.',
        interruptionLevel: 'passive',
        threadIdentifier: kind,
      });
      expect(reminderContent(notice, ukrainian)).toMatchObject({
        title: 'Нагадування призупинено',
        body: 'Увімкніть їх знову в Кіко.',
      });
    },
  );
});

describe('reminderContent — lock-screen safety, every text in both languages', () => {
  const counts = [0, 1, 2, 5, 21, null];
  const cases = (['statement_import', 'add_transactions'] as const).flatMap((kind) =>
    (['reminder', 'pausedNotice'] as const).flatMap((variant) =>
      [english, ukrainian].flatMap((t) =>
        counts.map((count) => ({
          content: reminderContent(request({ kind, variant, daysSinceData: count }), t),
          shownCount: variant === 'reminder' ? count : null,
        })),
      ),
    ),
  );

  it('covers every kind, variant, language and count', () => {
    expect(cases).toHaveLength(2 * 2 * 2 * counts.length);
  });

  it('holds no number but the day count', () => {
    for (const { content, shownCount } of cases) {
      const numbers = `${content.title} ${content.body}`.match(/\d+/g) ?? [];

      expect(numbers).toEqual(foldMap(maybe(shownCount), (count) => [String(count)]) ?? []);
    }
  });

  it('never names the app in the title', () => {
    for (const { content } of cases) {
      expect(content.title).not.toMatch(/Kiko|Кіко/i);
    }
  });

  it('never holds the account name or an identifier', () => {
    for (const { content } of cases) {
      expect(`${content.title} ${content.body}`).not.toContain(ACCOUNT_NAME);
    }
  });
});
