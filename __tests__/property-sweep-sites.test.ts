import { join } from 'node:path';

import { readTextFile } from './test-support/read-text-file';
import { repositoryFiles } from './test-support/repository-files';

const ROOT = join(__dirname, '..');
const SEED_PATTERN = /const SEEDS\b|seededRandom\s*=|for \(let seed\b/;
const SWEEP_IMPORT = '@kiko/test-support/property-sweep';
// A named class table and one fixed seed for a performance fixture are not random seed lists.
const EXCLUDED = [
  'src/data-transfer/snapshot/restore-walk-state.two-path.test.ts',
  'src/categories/category-rules/__fixtures__/rules-performance-fixture.ts',
];

const seedSites = (): string[] =>
  repositoryFiles(ROOT)
    .filter((file) => /\.test\.tsx?$/.test(file) && !EXCLUDED.includes(file))
    .filter((file) => SEED_PATTERN.test(readTextFile(join(ROOT, file))))
    .sort();

describe('property sweep sites', () => {
  it('finds the seed-list test files', () => {
    expect(seedSites().length).toBeGreaterThanOrEqual(9);
  });

  it('passes every seed list through sweep', () => {
    expect(
      seedSites().filter((file) => !readTextFile(join(ROOT, file)).includes(SWEEP_IMPORT)),
    ).toEqual([]);
  });
});
