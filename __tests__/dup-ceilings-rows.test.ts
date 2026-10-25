import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const REPOSITORY_ROOT = join(__dirname, '..');

// dup.sh fails a figure only when it is over the threshold, so a row at or under it is dead.
function rowsAtOrUnderThreshold(tsvText: string, threshold: number): string[] {
  return tsvText
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .filter((line) => Number(line.split('\t')[1]) <= threshold);
}

describe('rowsAtOrUnderThreshold', () => {
  it.each([
    ['a row equal to the threshold', 'a.ts\t5.00'],
    ['a row under the threshold', 'a.ts\t4.54'],
    ['the combined row at the threshold', '*combined*\t5'],
  ])('flags a row at or under the threshold: %s', (_label, row) => {
    expect(rowsAtOrUnderThreshold(row, 5)).toEqual([row]);
  });

  it('keeps a row above it', () => {
    expect(rowsAtOrUnderThreshold('a.ts\t5.01', 5)).toEqual([]);
  });

  it('skips comment lines', () => {
    expect(rowsAtOrUnderThreshold('# a note 4.00\t4.00', 5)).toEqual([]);
  });
});

describe('scripts/checks/dup-ceilings.tsv', () => {
  // Both files are data outside stryker.conf.json `mutate`, so no mutated source text is parsed.
  it('every row is above the .jscpd.json threshold', () => {
    const ceilings = readFileSync(join(REPOSITORY_ROOT, 'scripts/checks/dup-ceilings.tsv'), 'utf8');
    const { threshold } = JSON.parse(readFileSync(join(REPOSITORY_ROOT, '.jscpd.json'), 'utf8'));

    expect(rowsAtOrUnderThreshold(ceilings, threshold)).toEqual([]);
  });
});
