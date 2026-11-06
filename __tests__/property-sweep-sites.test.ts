import { join } from 'node:path';

import { readTextFile } from './test-support/read-text-file';
import { repositoryFiles } from './test-support/repository-files';

const ROOT = join(__dirname, '..');
const OWN_FILE = '__tests__/property-sweep-sites.test.ts';
const SEED_PATTERN = /const SEEDS\b|seededRandom\s*=|for \((let|const) seed\b/;
const SEED_LIST_DEFINITION = /\b([A-Z_]*SEEDS)\s*=\s*(sweep\()?/g;
const SWEEP_IMPORT = '@kiko/test-support/property-sweep';
// Neither is a list of random seeds: a named class table, and the rows a test inserts into a
// database it seeds.
const EXCLUDED = [
  'src/data-transfer/snapshot/restore-walk-state.two-path.test.ts',
  'src/holdings/lot-recost/lot-recost.test.ts',
];

const seedSites = (): string[] =>
  repositoryFiles(ROOT)
    .filter((file) => /\.test\.tsx?$/.test(file) && file !== OWN_FILE && !EXCLUDED.includes(file))
    .filter((file) => SEED_PATTERN.test(readTextFile(join(ROOT, file))))
    .sort();

// A list that is only the source of a swept one (`sweep(FULL_SEEDS)`) is passed through too.
const unsweptLists = (file: string): string[] => {
  const text = readTextFile(join(ROOT, file));

  return [...text.matchAll(SEED_LIST_DEFINITION)]
    .filter(([, name, sweepCall]) => sweepCall === undefined && !text.includes(`sweep(${name})`))
    .map(([, name]) => `${file}: ${name}`);
};

describe('property sweep sites', () => {
  it('finds exactly the seed-list test files', () => {
    expect(seedSites()).toEqual([
      'src/categories/category-rules/plan-review-groups.test.ts',
      'src/crypto-sync/binance/binance.convert-history.properties.test.ts',
      'src/crypto-sync/binance/binance.dust-history.properties.test.ts',
      'src/crypto-sync/binance/binance.fiat-history.properties.test.ts',
      'src/crypto-sync/binance/binance.history-walk.properties.test.ts',
      'src/crypto-sync/binance/binance.id-cursor-pager.test.ts',
      'src/crypto-sync/binance/binance.p2p-history.properties.test.ts',
      'src/crypto-sync/binance/binance.trade-history.properties.test.ts',
      'src/crypto-sync/binance/binance.trade-symbols.properties.test.ts',
      'src/crypto-sync/binance/binance.walks.backfill.properties.test.ts',
      'src/crypto-sync/binance/binance.walks.multi-coin.properties.test.ts',
      'src/currency/currency-group/currency-group.test.ts',
      'src/design-system/entity-tint/entity-tint.test.ts',
      'src/recurring/detection/detection.test.ts',
      'src/recurring/eligibility/eligibility.test.ts',
      'src/recurring/marked-series/marked-series.test.ts',
      'src/recurring/row-recurrence/row-recurrence.properties.test.ts',
      'src/statistics/category-by-month/category-by-month.property.test.ts',
      'src/statistics/internal-transfers/internal-transfers.test.ts',
      'src/transactions/merchant-name/merchant-name.test.ts',
    ]);
  });

  it('imports sweep in every seed-list file', () => {
    expect(
      seedSites().filter((file) => !readTextFile(join(ROOT, file)).includes(SWEEP_IMPORT)),
    ).toEqual([]);
  });

  it('passes every seed list of a file through sweep', () => {
    expect(seedSites().flatMap(unsweptLists)).toEqual([]);
  });
});
