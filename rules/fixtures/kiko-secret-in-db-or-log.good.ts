// Semgrep fixture (NEGATIVE): logs and inserts of values that are not secrets,
// so NO rule may report a finding here. Names that merely contain "key" (a
// keyboard height, a list of keys) are not the secret. A `console.*` call
// with a non-literal argument is itself denied by another rule, so the name
// probes below go through an insert.
declare const database: { insert: (table: unknown) => { values: (row: unknown) => unknown } };
declare const table: unknown;
declare const keys: string[];
declare const monkey: string;
declare const keyboardHeight: number;
declare const eodhdPrices: unknown;
declare const row: unknown;

export const fixtureGoodLog = (): void => {
  console.log('synced');
};

export const fixtureGoodInsert = (): void => {
  database.insert(table).values(row);
  database.insert(table).values(keys);
  database.insert(table).values(monkey);
  database.insert(table).values(keyboardHeight);
  database.insert(table).values(eodhdPrices);
};
