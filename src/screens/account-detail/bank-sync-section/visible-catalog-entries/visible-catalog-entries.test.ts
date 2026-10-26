import visibleCatalogEntries from '.';

describe('visibleCatalogEntries', () => {
  it('lists every wired provider catalog entry (Guideline 2.3.1(a) remediation: Monobank-only, unconditional)', () => {
    expect(visibleCatalogEntries().map((entry) => entry.id)).toEqual(['monobank']);
  });
});
