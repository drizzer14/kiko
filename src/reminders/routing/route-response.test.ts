import { i18n } from '@kiko/i18n/init';
import type { NotificationResponse } from '@kiko/reminders/native';

import { latestOpenResponse, routeFor } from './route-response';

const CASH = { id: 'cash', name: 'Cash', kind: 'cash', archivedAt: null } as const;
const PROPERTIES = {
  id: 'properties',
  name: 'Properties',
  kind: 'property',
  archivedAt: null,
} as const;
const LOANS = { id: 'loans', name: 'Loans', kind: 'debt', archivedAt: null } as const;
const ARCHIVED_PROPERTIES = { ...PROPERTIES, archivedAt: 1 } as const;
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
        next: { screen: 'AccountReminders', params: { accountId: 'cash' } },
      });
    },
  );

  it('goes nowhere for a paused notice tap whose account is gone', () => {
    expect(routeFor(pausedNoticeTap, 'add_transactions', undefined, [])).toBeUndefined();
  });

  // An implicit account has its own AccountDetail page (its section heading
  // on the Accounts screen opens it), so a reminder merged onto it opens that
  // page like any other account's, titled with its localized default name.
  describe.each([
    ['property', PROPERTIES, 'Properties'],
    ['debt', LOANS, 'Loans'],
  ])('an implicit %s account', (_kind, account, title) => {
    const accountDetail = { accountId: account.id, name: title };

    it.each([
      ['no open holdings', []],
      ['one open property item', [{ id: 'flat', type: 'property_item' } as const]],
      ['one open loan', [{ id: 'car', type: 'loan' } as const]],
    ])('opens only its AccountDetail for an add-transactions tap with %s', (_label, holdings) => {
      expect(routeFor(tap(), 'add_transactions', account, holdings)).toEqual({ accountDetail });
    });

    it('opens its AccountDetail with the file-picker intent for an import reminder tap', () => {
      expect(routeFor(tap(), 'statement_import', account, [])).toEqual({
        accountDetail: { ...accountDetail, intent: 'importStatement' },
      });
    });

    it.each(['statement_import', 'add_transactions'] as const)(
      'opens the account reminders page above its AccountDetail for a tap on the %s paused notice',
      (kind) => {
        expect(routeFor(pausedNoticeTap, kind, account, [])).toEqual({
          accountDetail,
          next: { screen: 'AccountReminders', params: { accountId: account.id } },
        });
      },
    );
  });

  describe('the page title of an implicit account', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('is the localized default name, not the stored English sentinel', async () => {
      await i18n.changeLanguage('uk');

      expect(routeFor(tap(), 'add_transactions', PROPERTIES, [])).toEqual({
        accountDetail: { accountId: 'properties', name: 'Майно' },
      });
      expect(routeFor(tap(), 'add_transactions', LOANS, [])).toEqual({
        accountDetail: { accountId: 'loans', name: 'Кредити' },
      });
    });

    it('is the name the user typed once the account is renamed', () => {
      expect(
        routeFor(tap(), 'add_transactions', { ...PROPERTIES, name: 'Real estate' }, []),
      ).toEqual({ accountDetail: { accountId: 'properties', name: 'Real estate' } });
    });
  });

  it('routes an archived property account like any other account', () => {
    expect(routeFor(tap(), 'add_transactions', ARCHIVED_PROPERTIES, [])).toEqual({
      accountDetail: { accountId: 'properties', name: 'Properties' },
    });
  });
});

describe('latestOpenResponse', () => {
  it('is undefined with no responses', () => {
    expect(latestOpenResponse([])).toBeUndefined();
  });

  it('is undefined when every response is a snooze', () => {
    expect(latestOpenResponse([tap({ action: 'snooze' })])).toBeUndefined();
  });

  it('picks the last tap in the queue, which holds them in tap order', () => {
    const earlier = tap({ reminderId: 'earlier', respondedAt: 1000 });
    const later = tap({ reminderId: 'later', respondedAt: 2000 });

    expect(latestOpenResponse([earlier, later])).toBe(later);
  });

  it('skips a later snooze for the latest tap', () => {
    const opened = tap({ reminderId: 'opened', respondedAt: 1000 });
    const snoozed = tap({ reminderId: 'snoozed', action: 'snooze', respondedAt: 2000 });

    expect(latestOpenResponse([opened, snoozed])).toBe(opened);
  });
});
