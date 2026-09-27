// src/i18n/locales/flatten-catalog.ts
//
// Shared by every `en`/`uk` catalog test (`en.casing-by-role.test.ts`,
// `uk.casing.test.ts`, `en.uk.parity.test.ts`, `uk.catalog-rules.test.ts`) —
// one tree-flattener instead of four near-identical copies (CASE fix round
// 1/5, ponytail L43/L25). Walks a nested catalog object into dotted leaf
// paths (`{ path: 'calendar.month.january', value: 'January' }`) at RUNTIME,
// not the source text, so a violation buried behind an interpolation or a
// computed value is caught the same as a plain literal.
type CatalogLeaf = { path: string; value: string };

export const flattenCatalog = (object: unknown, prefix = ''): CatalogLeaf[] => {
  if (typeof object === 'string') {
    return [{ path: prefix, value: object }];
  }

  if (object !== null && typeof object === 'object') {
    return Object.entries(object as Record<string, unknown>).flatMap(([key, value]) =>
      flattenCatalog(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [];
};
