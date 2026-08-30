jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { settingsRepo } from './settings.repo';

describe('settingsRepo', () => {
  it('builds a single-row settings query', () => {
    expect(settingsRepo.getQuery().toSQL().sql).toContain('settings');
  });
});
