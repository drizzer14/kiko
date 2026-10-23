// Semgrep fixture (POSITIVE): app source reaches into test scaffolding (Guideline 2.5.19: nothing
// test-only ships in a release build). `kiko-no-test-fixture-import-in-app` MUST report a finding
// on each pinned line below: an `import ... from` a `-test-fixtures` module, an `export ... from`
// a `-test-helper` module, and a `require(...)` of a `/test-support/` module. This file's own name
// matches none of the rule's excluded paths, so the rule scans it. Never "fix" this file.
//
// The specifiers are real relative paths so `check:typecheck`, which scans `rules/fixtures/**`,
// resolves them; the rule matches on the specifier's ending only.

// EXPECT-FINDING
import { NOW } from '../../src/crypto-sync/binance/binance.pay-test-fixtures';

// EXPECT-FINDING
export { composeRateTable } from '../../src/rates/monobank-feed-test-helper';

// EXPECT-FINDING
import { SEEDED_CATEGORIES } from '../../src/db/__fixtures__/seeded-categories';

// EXPECT-FINDING
import type { DepthRead } from '../../src/crypto-sync/binance/binance.depth-test-fixtures';

export const seededCount = (): number => SEEDED_CATEGORIES.length;

export type CurrentRead = DepthRead;

export const currentTime = (): number => NOW;

export const lazyHold = (): unknown =>
  // EXPECT-FINDING
  require('../../src/test-support/held-currencies') as typeof import('../../src/test-support/held-currencies');
