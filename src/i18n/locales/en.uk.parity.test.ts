// src/i18n/locales/en.uk.parity.test.ts
import { en } from './en';
import { uk } from './uk';
import { flattenCatalog } from './flatten-catalog';

// Every leaf key path present in en must be present in uk and vice versa.
const leafPaths = (object: Record<string, unknown>): string[] =>
  flattenCatalog(object).map(({ path }) => path);

describe('en/uk catalog parity', () => {
  it('exposes the exact same key set in both languages', () => {
    expect(leafPaths(uk).sort()).toEqual(leafPaths(en).sort());
  });
});
