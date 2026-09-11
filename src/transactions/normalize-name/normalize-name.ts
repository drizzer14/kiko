/**
 * The ONE normalization used to match transactions by name. Applied in JS
 * everywhere a name is compared — never in SQL: SQLite's built-in lower() is
 * ASCII-only and would silently fail to match case-variant Cyrillic Monobank
 * merchant names. Order: NFC (unify composed/decomposed unicode) → collapse
 * internal whitespace runs → trim edges → lowercase (full-Unicode via JS).
 */
export const normalizeTransactionName = (name: string): string =>
  name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
