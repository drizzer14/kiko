import type { NotificationResponse } from '@kiko/reminders/native';

import { latestOpenResponse, routeFor } from './route-response';

const CASH = { id: 'cash', name: 'Cash' };
const WALLET = { id: 'wallet', type: 'cash' } as const;
const DEPOSIT = { id: 'deposit', type: 'term_deposit' } as const;

const tap = (overrides: Partial<NotificationResponse> = {}): NotificationResponse => ({
  reminderId: 'reminder-1',
  requestIdentifier: 'kiko.reminder.reminder-1.202610012000',
  action: 'open',
  respondedAt: 1000,
  ...overrides,
});

const pausedNoticeTap = tap({ requestIdentifier: 'kiko.reminder.reminder-1.paused' });

describe('routeFor', () => {
  it.each(['statement_import', 'add_transactions'] as const)(
    'goes nowhere for a %s tap whose account is gone',
    (kind) => {
      expect(routeFor(tap(), kind, undefined, [WALLET])).toBeUndefined();
    },
  );

  it('opens the account and asks it to show the file picker for an import reminder', () => {
    expect(routeFor(tap(), 'statement_import', CASH, [WALLET])).toEqual({
      accountDetail: { accountId: 'cash', name: 'Cash', intent: 'importStatement' },
    });
  });

  it('opens the new-transaction form above the account when it has one open holding', () => {
    expect(routeFor(tap(), 'add_transactions', CASH, [WALLET])).toEqual({
      accountDetail: { accountId: 'cash', name: 'Cash' },
      next: { screen: 'TransactionForm', params: { holdingId: 'wallet' } },
    });
  });

  it.each([
    ['no open holdings', []],
    ['two open holdings', [WALLET, { id: 'jar', type: 'jar' } as const]],
    ['one open holding that takes no transactions', [DEPOSIT]],
  ])('opens only the account for an add-transactions tap with %s', (_holdings, openHoldings) => {
    expect(routeFor(tap(), 'add_transactions', CASH, openHoldings)).toEqual({
      accountDetail: { accountId: 'cash', name: 'Cash' },
    });
  });

  it.each(['statement_import', 'add_transactions'] as const)(
    'opens the account reminders page for a tap on the %s paused notice',
    (kind) => {
      expect(routeFor(pausedNoticeTap, kind, CASH, [WALLET])).toEqual({
        accountDetail: { accountId: 'cash', name: 'Cash' },
        next: { screen: 'AccountReminders', params: { accountId: 'cash', name: 'Cash' } },
      });
    },
  );

  it('goes nowhere for a paused notice tap whose account is gone', () => {
    expect(routeFor(pausedNoticeTap, 'add_transactions', undefined, [])).toBeUndefined();
  });
});

describe('latestOpenResponse', () => {
  it('is undefined with no responses', () => {
    expect(latestOpenResponse([])).toBeUndefined();
  });

  it('is undefined when every response is a snooze', () => {
    expect(latestOpenResponse([tap({ action: 'snooze' })])).toBeUndefined();
  });

  it('picks the latest tap, whatever the queue order', () => {
    const earlier = tap({ reminderId: 'earlier', respondedAt: 1000 });
    const later = tap({ reminderId: 'later', respondedAt: 2000 });

    expect(latestOpenResponse([later, earlier])).toBe(later);
    expect(latestOpenResponse([earlier, later])).toBe(later);
  });

  it('skips a later snooze for the latest tap', () => {
    const opened = tap({ reminderId: 'opened', respondedAt: 1000 });
    const snoozed = tap({ reminderId: 'snoozed', action: 'snooze', respondedAt: 2000 });

    expect(latestOpenResponse([opened, snoozed])).toBe(opened);
  });
});
