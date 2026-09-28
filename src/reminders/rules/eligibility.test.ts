import { eligibleReminderKinds } from './eligibility';

const MANUAL_ACCOUNT = { institution: null };
const SYNCED_ACCOUNT = { institution: 'monobank' };

describe('eligibleReminderKinds', () => {
  it('offers only add-transactions on a manual account with no import', () => {
    expect(eligibleReminderKinds(MANUAL_ACCOUNT, false)).toEqual(['add_transactions']);
  });

  it('offers both kinds, import first, on a manual account with an import', () => {
    expect(eligibleReminderKinds(MANUAL_ACCOUNT, true)).toEqual([
      'statement_import',
      'add_transactions',
    ]);
  });

  it('offers only import on a synced account with an import', () => {
    expect(eligibleReminderKinds(SYNCED_ACCOUNT, true)).toEqual(['statement_import']);
  });

  it('offers nothing on a synced account with no import', () => {
    expect(eligibleReminderKinds(SYNCED_ACCOUNT, false)).toEqual([]);
  });

  it('treats an institution no sync owns as manual', () => {
    expect(eligibleReminderKinds({ institution: 'some-old-bank' }, false)).toEqual([
      'add_transactions',
    ]);
  });
});
