import visibleCatalogEntries from '.';

describe('visibleCatalogEntries', () => {
  it('lists every provider catalog entry the registry wires', () => {
    expect(visibleCatalogEntries().map((entry) => entry.id)).toEqual(['monobank']);
  });
});
