// src/i18n/locales/en.uk.parity.test.ts
import { en } from './en';
import { uk } from './uk';

// Every leaf key path present in en must be present in uk and vice versa. A
// nested object is walked depth-first into dotted paths ('calendar.month.january').
const leafPaths = (object: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object') {
      return leafPaths(value as Record<string, unknown>, path);
    }

    return [path];
  });

describe('en/uk catalog parity', () => {
  it('exposes the exact same key set in both languages', () => {
    expect(leafPaths(uk).sort()).toEqual(leafPaths(en).sort());
  });
});
