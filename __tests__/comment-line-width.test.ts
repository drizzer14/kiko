import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/comment-line-width.js mechanizes kiko-code-style's "Wrap comments at 100
// columns": Biome's formatter.lineWidth is 100 but Biome cannot wrap a comment, so a long
// comment stays long until its author wraps it. The checker finds REAL comment spans (a string,
// template or regex literal that only looks like a comment never counts) and fails a physical
// line over 100 columns that holds comment text, unless that comment cannot be wrapped.
const ROOT = join(__dirname, '..');
const CHECKER = join(ROOT, 'scripts/checks/comment-line-width.js');
const SCRIPT = join(ROOT, 'scripts/checks/comment-line-width.sh');
const LIMIT = 100;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'comment-line-width-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

// A line of exactly `width` code points that starts with `lead`, filled with short words and
// ending in a non-space character.
const lineOfWidth = (lead: string, width: number): string => {
  const body = `${lead}${' ab'.repeat(width)}`.slice(0, width - 1);

  return `${body}x`;
};

const urlOfWidth = (width: number): string =>
  `https://example.com/${'p'.repeat(width)}`.slice(0, width);

const writeProbe = (relativePath: string, source: string): string => {
  const file = join(directory, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);

  return file;
};

const runChecker = (source: string, relativePath = 'src/probe.ts'): SpawnSyncReturns<string> =>
  spawnSync('node', [CHECKER, writeProbe(relativePath, source)], { encoding: 'utf8', cwd: ROOT });

const findingLines = (result: SpawnSyncReturns<string>): string[] =>
  result.stdout.split('\n').filter((line) => line !== '');

describe('scripts/checks/comment-line-width.js', () => {
  it('passes a comment of exactly 100 columns and flags one of 101', () => {
    const flagged = lineOfWidth('// ', LIMIT + 1);

    expect(runChecker(`${lineOfWidth('// ', LIMIT)}\nexport const value = 1;\n`).status).toBe(0);

    const result = runChecker(`export const value = 1;\n${flagged}\n`);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(findingLines(result)).toEqual([
      `${join(directory, 'src/probe.ts')}:2: 101 columns: ${flagged}`,
    ]);
  });

  it('counts Unicode code points, not bytes: 100 Cyrillic letters pass and 101 fail', () => {
    const cyrillic = (count: number): string => `// ${'я'.repeat(count - 5)} к`;

    expect(Buffer.byteLength(cyrillic(LIMIT))).toBeGreaterThan(LIMIT);
    expect(runChecker(`${cyrillic(LIMIT)}\n`).status).toBe(0);
    expect(runChecker(`${cyrillic(LIMIT + 1)}\n`).status).toBe(1);
  });

  it('flags an indented comment by the whole physical line', () => {
    const line = lineOfWidth('    // ', LIMIT + 3);

    expect(findingLines(runChecker(`function f() {\n${line}\n}\n`))).toEqual([
      `${join(directory, 'src/probe.ts')}:2: 103 columns: ${line.trim()}`,
    ]);
  });

  it('flags every line of a block comment, with the trimmed line as the text', () => {
    const source = [
      '/**',
      lineOfWidth(' * first', LIMIT + 5),
      ' * short',
      lineOfWidth(' * second', LIMIT + 3),
      ' */',
      '',
    ].join('\n');

    const lines = findingLines(runChecker(source));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(':2: 105 columns: * first');
    expect(lines[1]).toContain(':4: 103 columns: * second');
  });

  it.each([
    ['inside the comment', 4],
    ['at the closing brace only', 0],
  ])('flags a JSX comment that overflows %s', (_label, overhang) => {
    const comment = `${lineOfWidth('/* ', LIMIT - 8 + overhang)} */`;
    const source = `export const view = (\n  <View>\n    {${comment}}\n  </View>\n);\n`;

    const lines = findingLines(runChecker(source, 'src/probe.tsx'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`:3: ${LIMIT + 1 + overhang} columns: /* `);
  });

  describe('a JSX comment is measured with its braces, flagged and exempted alike', () => {
    const jsxLine = (comment: string): string =>
      `export const view = (\n  <View>\n    {${comment}}\n  </View>\n);\n`;

    it.each([
      [LIMIT, 0],
      [LIMIT + 1, 1],
      [LIMIT + 2, 1],
      [LIMIT + 3, 1],
    ])('flags words that wrap at %i columns: %i finding(s)', (width, count) => {
      const comment = `${lineOfWidth('/* ', width - 9)} */`;

      expect(findingLines(runChecker(jsxLine(comment), 'src/probe.tsx'))).toHaveLength(count);
    });

    it.each([LIMIT, LIMIT + 1, LIMIT + 2, LIMIT + 3])(
      'passes one URL with nothing to wrap at %i columns',
      (width) => {
        const comment = `/* ${urlOfWidth(width - 12)} */`;
        const source = jsxLine(comment);

        expect(source.split('\n')[2]).toHaveLength(width);
        expect(runChecker(source, 'src/probe.tsx')).toMatchObject({ status: 0, stdout: '' });
      },
    );
  });

  // Only a JSX expression container `{/* */}` keeps its braces in the measure. A block's own
  // braces hold the comment loosely, so a comment that ends within the limit passes whatever
  // follows it.
  describe('a block that holds a comment is not a JSX expression container', () => {
    const head = 'function f() { ';
    const blockWithCommentEndingAt = (column: number): string =>
      `${head}${lineOfWidth('/* ', column - head.length - 3)} */ }\n`;

    it.each([
      [LIMIT - 1, 0],
      [LIMIT, 0],
      [LIMIT + 1, 1],
    ])('a comment ending at column %i: %i finding(s)', (column, count) => {
      expect(findingLines(runChecker(blockWithCommentEndingAt(column)))).toHaveLength(count);
    });
  });

  it('keys the text on the comments only when one line holds two of them', () => {
    const note = `/* ${'word '.repeat(10)}*/`;
    const code = (name: string): string => `const first = 1; ${note} const ${name} = 2; ${note}`;

    const lines = [code('other'), code('renamedOther')].map((source) =>
      findingLines(runChecker(`${source}\n`)),
    );

    expect(lines[0]).toHaveLength(1);
    expect(lines[0][0].endsWith(`columns: ${note} ${note}`)).toBe(true);
    expect(lines[1][0].endsWith(`columns: ${note} ${note}`)).toBe(true);
  });

  it('flags a trailing comment whose own line is over, naming the comment text only', () => {
    const comment = lineOfWidth('// ', 40);
    const code = `export const total = compute(${'a'.repeat(40)}, 2);`;

    const result = runChecker(`${code} ${comment}\n`);

    expect(findingLines(result)).toEqual([
      `${join(directory, 'src/probe.ts')}:1: ${code.length + 1 + comment.length} columns: ${comment}`,
    ]);
  });

  it('flags a comment inside a template-literal substitution', () => {
    const comment = lineOfWidth('/* ', LIMIT + 5);

    expect(runChecker(`export const label = \`\${${comment} */ value}\`;\n`).status).toBe(1);
  });

  it('flags the comment line after a string literal that holds a quote', () => {
    const comment = lineOfWidth('// ', LIMIT + 5);

    expect(runChecker(`const quote = "it's";\n${comment}\n`).status).toBe(1);
  });

  describe('a literal that only looks like a comment never counts', () => {
    const wide = (inner: string): string => `${inner}${'a'.repeat(LIMIT)}`;

    it.each([
      ['a string', `export const text = '// ${'a'.repeat(LIMIT)}';\n`],
      ['a double-quoted string', `export const text = "/* ${'a'.repeat(LIMIT)} */";\n`],
      ['a template literal', `export const text = \`// ${'a'.repeat(LIMIT)}\`;\n`],
      [
        'a multi-line template literal',
        `export const text = \`\n// ${'a b '.repeat(LIMIT)}\n\`;\n`,
      ],
      ['a regex literal', `export const pattern = /\\/\\/${'a'.repeat(LIMIT)}/;\n`],
      ['a url in a string', `export const url = '${wide('https://example.com/')}';\n`],
    ])('%s', (_label, source) => {
      expect(runChecker(source)).toMatchObject({ status: 0, stdout: '' });
    });
  });

  it('never flags a long code line that has no comment', () => {
    const source = `export const total = compute(${'argument, '.repeat(20)}last);\n`;

    expect(source.length).toBeGreaterThan(LIMIT);
    expect(runChecker(source).status).toBe(0);
  });

  it('never flags code after a block comment that ends within the limit', () => {
    const source = `/* note */ export const total = compute(${'argument, '.repeat(20)}last);\n`;

    expect(runChecker(source).status).toBe(0);
  });

  it('measures a line without its trailing whitespace', () => {
    expect(runChecker(`${lineOfWidth('// ', LIMIT)}   \nexport const value = 1;\n`).status).toBe(0);
  });

  it('reads a CRLF file by the same width', () => {
    expect(runChecker(`${lineOfWidth('// ', LIMIT)}\r\nexport const value = 1;\r\n`).status).toBe(
      0,
    );
    expect(
      runChecker(`${lineOfWidth('// ', LIMIT + 1)}\r\nexport const value = 1;\r\n`).status,
    ).toBe(1);
  });

  describe('a comment that cannot be wrapped is exempt', () => {
    it('passes one URL as the whole comment text', () => {
      expect(runChecker(`// ${urlOfWidth(LIMIT + 20)}\n`)).toMatchObject({ status: 0, stdout: '' });
    });

    it('passes a block-comment line that is one URL after its leader', () => {
      expect(runChecker(`/**\n * ${urlOfWidth(LIMIT + 20)}\n */\n`).status).toBe(0);
    });

    it('passes an unbreakable word in a trailing comment that cannot move to a line of its own', () => {
      const source = `export const value = 1; // ${urlOfWidth(LIMIT + 20)}\n`;

      expect(runChecker(source).status).toBe(0);
    });

    it('flags a URL after words, because the words can wrap before it', () => {
      const result = runChecker(`// see ${urlOfWidth(LIMIT)}\n`);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(' columns: // see https://');
    });

    it('flags a short trailing comment that only the code before it pushes over', () => {
      const code = `export const total = compute(${'a'.repeat(40)}, ${'b'.repeat(25)});`;
      const result = runChecker(`${code} // note\n`);

      expect(code.length).toBeLessThan(LIMIT);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(': // note\n');
    });

    it('wraps when the first word ends at column 100, and is exempt when it ends at 101', () => {
      const first = (width: number): string => `// ${'w'.repeat(width - 3)} tail`;

      expect(runChecker(`${first(LIMIT)}\n`).status).toBe(1);
      expect(runChecker(`${first(LIMIT + 1)}\n`).status).toBe(0);
    });

    it('passes a glued opener and one long word', () => {
      expect(runChecker(`//${urlOfWidth(LIMIT + 10)}\n`).status).toBe(0);
    });

    it('treats a closing marker as no word: /* url */ has no wrap point', () => {
      expect(runChecker(`/* ${urlOfWidth(LIMIT + 5)} */\n`).status).toBe(0);
    });
  });

  it('reports every file named, each finding on its own line', () => {
    const first = writeProbe('src/first.ts', `${lineOfWidth('// ', LIMIT + 1)}\n`);
    const second = writeProbe('src/second.ts', `\n${lineOfWidth('// ', LIMIT + 2)}\n`);

    const result = spawnSync('node', [CHECKER, first, second], { encoding: 'utf8', cwd: ROOT });

    expect(result.status).toBe(1);
    expect(findingLines(result).map((line) => line.slice(0, line.indexOf(' columns')))).toEqual([
      `${first}:1: 101`,
      `${second}:2: 102`,
    ]);
  });

  it('exits 2 and writes to stderr when a file cannot be read', () => {
    const result = spawnSync('node', [CHECKER, join(directory, 'missing.ts')], {
      encoding: 'utf8',
      cwd: ROOT,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('comment-line-width');
  });
});

describe('scripts/checks/comment-line-width.sh', () => {
  const longComment = lineOfWidth('// ', LIMIT + 1);

  const runWrapper = (): SpawnSyncReturns<string> =>
    spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, COMMENT_LINE_WIDTH_SOURCE_ROOT: directory },
    });

  it('stays silent on a clean tree', () => {
    writeProbe('src/clean.ts', '// short\nexport const value = 1;\n');

    expect(runWrapper()).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });

  it('fails the project-wide mode with the structured block and the finding', () => {
    writeProbe('src/clean.ts', 'export const value = 1;\n');
    const dirty = writeProbe('src/dirty.tsx', `${longComment}\nexport const value = 1;\n`);

    const result = runWrapper();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Comment line width');
    expect(result.stderr).toContain(`${dirty}:1: 101 columns:`);
    expect(result.stderr).toContain('Wrap');
  });

  it('leaves a file that is not .ts or .tsx out of scope', () => {
    writeProbe('notes.md', `${longComment}\n`);

    expect(runWrapper()).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });
});
