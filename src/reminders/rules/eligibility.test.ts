import { eligibleReminderKinds } from '.';

const MANUAL_ACCOUNT = { institution: null };
const SYNCED_ACCOUNT = { institution: 'monobank' };

describe('eligibleReminderKinds', () => {
  it('offers both kinds, import first, on a manual account', () => {
    expect(eligibleReminderKinds(MANUAL_ACCOUNT)).toEqual(['statement_import', 'add_transactions']);
  });

  it('offers only import on a synced account', () => {
    expect(eligibleReminderKinds(SYNCED_ACCOUNT)).toEqual(['statement_import']);
  });

  it('treats an institution no sync owns as manual', () => {
    expect(eligibleReminderKinds({ institution: 'some-old-bank' })).toEqual([
      'statement_import',
      'add_transactions',
    ]);
  });
});
