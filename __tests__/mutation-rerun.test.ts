import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/mutation-rerun.js prepares the rerun of a gate's timed-out mutants: it removes
// exactly the candidates (`path<TAB>mutant id` lines on stdin, the output of
// `mutation-score.js --rerun-candidates`) from Stryker's incremental file, so Stryker runs only
// those again and reuses every other result. The script is spawned by path, like the scorer.
const SCRIPT = join(__dirname, '../scripts/checks/mutation-rerun.js');

let directory: string;
let incrementalPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kiko-mutation-rerun-'));
  incrementalPath = join(directory, 'stryker-incremental.json');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

type Mutant = { id: string; status: string; mutatorName: string };

const mutant = (identifier: string, status: string): Mutant => ({
  id: identifier,
  status,
  mutatorName: 'ConditionalExpression',
});

const incremental = (): Record<string, unknown> => ({
  schemaVersion: '1',
  thresholds: { high: 80, low: 60 },
  testFiles: { 'src/heavy.test.ts': { tests: [{ id: '0', name: 'a test' }] } },
  files: {
    'src/heavy.ts': {
      language: 'typescript',
      source: 'export const heavy = 1;\n',
      mutants: [
        mutant('1', 'Killed'),
        mutant('2', 'Timeout'),
        mutant('3', 'Timeout'),
        mutant('4', 'Survived'),
      ],
    },
    'src/other.ts': {
      language: 'typescript',
      source: 'export const other = 2;\n',
      mutants: [mutant('2', 'Timeout'), mutant('5', 'Killed')],
    },
  },
});

const writeIncremental = (body: unknown = incremental()): string => {
  writeFileSync(incrementalPath, JSON.stringify(body));

  return readFileSync(incrementalPath, 'utf8');
};

const candidates = (...rows: Array<[path: string, identifier: string]>): string =>
  `${rows.map(([path, identifier]) => `${path}\t${identifier}`).join('\n')}\n`;

const rerun = (input: string, ...scriptArguments: string[]): SpawnSyncReturns<string> =>
  spawnSync('node', [SCRIPT, ...scriptArguments], { encoding: 'utf8', input });

const readIncremental = (): ReturnType<typeof incremental> =>
  JSON.parse(readFileSync(incrementalPath, 'utf8'));

describe('scripts/checks/mutation-rerun.js', () => {
  it('removes exactly the named mutants of the named files and keeps everything else', () => {
    writeIncremental();

    const result = rerun(candidates(['src/heavy.ts', '2'], ['src/heavy.ts', '3']), incrementalPath);

    const expected = incremental() as { files: Record<string, { mutants: Mutant[] }> };
    expected.files['src/heavy.ts'].mutants = [mutant('1', 'Killed'), mutant('4', 'Survived')];
    expect(result.status).toBe(0);
    expect(readIncremental()).toEqual(expected);
  });

  it('matches a mutant by file and id, so the same id in another file stays', () => {
    writeIncremental();

    const result = rerun(candidates(['src/other.ts', '2']), incrementalPath);

    const after = readIncremental() as { files: Record<string, { mutants: Mutant[] }> };
    expect(result.status).toBe(0);
    expect(after.files['src/other.ts'].mutants).toEqual([mutant('5', 'Killed')]);
    expect(after.files['src/heavy.ts'].mutants.map(({ id }) => id)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps a file whose mutants were all removed, so Stryker still knows its source', () => {
    writeIncremental();

    const result = rerun(candidates(['src/other.ts', '2'], ['src/other.ts', '5']), incrementalPath);

    const after = readIncremental() as {
      files: Record<string, { mutants: Mutant[]; source: string }>;
    };
    expect(result.status).toBe(0);
    expect(after.files['src/other.ts']).toEqual({
      language: 'typescript',
      source: 'export const other = 2;\n',
      mutants: [],
    });
  });

  it('exits 2 and names the path when the incremental file is missing', () => {
    const result = rerun(candidates(['src/heavy.ts', '2']), incrementalPath);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(incrementalPath);
    expect(existsSync(incrementalPath)).toBe(false);
  });

  it('exits 2 and leaves an unparsable incremental file as it was', () => {
    writeFileSync(incrementalPath, '{"files": {');

    const result = rerun(candidates(['src/heavy.ts', '2']), incrementalPath);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(incrementalPath);
    expect(readFileSync(incrementalPath, 'utf8')).toBe('{"files": {');
  });

  it.each([
    ['an unknown mutant id', candidates(['src/heavy.ts', '2'], ['src/heavy.ts', '99'])],
    ['an unknown file', candidates(['src/heavy.ts', '2'], ['src/missing.ts', '2'])],
  ])('exits 2 and changes nothing for %s', (_name, input) => {
    const before = writeIncremental();

    const result = rerun(input, incrementalPath);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/99|src\/missing\.ts/);
    expect(readFileSync(incrementalPath, 'utf8')).toBe(before);
  });

  it.each([
    ['no candidate', ''],
    ['a line without a tab', 'src/heavy.ts 2\n'],
    ['a line without an id', 'src/heavy.ts\t\n'],
  ])('exits 2 and changes nothing for %s', (_name, input) => {
    const before = writeIncremental();

    const result = rerun(input, incrementalPath);

    expect(result.status).toBe(2);
    expect(readFileSync(incrementalPath, 'utf8')).toBe(before);
  });

  it('exits 2 with a usage line when no incremental file is given', () => {
    const result = rerun(candidates(['src/heavy.ts', '2']));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: mutation-rerun.js <stryker-incremental.json>');
  });
});
