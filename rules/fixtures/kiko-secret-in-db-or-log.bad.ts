// Semgrep fixture (POSITIVE): a secret handed to a log or a database insert,
// so `kiko-secret-in-db-or-log` MUST report a finding on every pinned line.
// Never "fix" this file.
declare const database: { insert: (table: unknown) => { values: (row: unknown) => unknown } };
declare const table: unknown;
declare const token: string;
declare const secret: string;
declare const key: string;
declare const eodhdKey: string;
declare const apiKey: string;

export const fixtureBadLogToken = (): void => {
  // EXPECT-FINDING
  console.log(token);
  // EXPECT-FINDING
  console.warn(secret);
};

// The EODHD key is held in a variable named `key`.
export const fixtureBadLogKey = (): void => {
  // EXPECT-FINDING
  console.log(key);
};

export const fixtureBadLogNamedKey = (): void => {
  // EXPECT-FINDING
  console.error(eodhdKey);
  // EXPECT-FINDING
  console.info(apiKey);
};

export const fixtureBadInsert = (): void => {
  // EXPECT-FINDING
  database.insert(table).values(token);
  // EXPECT-FINDING
  database.insert(table).values(key);
};
