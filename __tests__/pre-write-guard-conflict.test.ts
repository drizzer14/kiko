import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// A file with git conflict markers does not parse, yet a merge is resolved
// through Edit/Write, so the guard must still let those writes through and
// still catch a violation the resolution adds. These run the REAL semgrep
// and the REAL Node checkers against a conflicted file on disk: a stub
// would not prove that real Semgrep's parse failure on the markers does not
// deny.
const SCRIPT = join(__dirname, '../scripts/checks/pre-write-guard.sh');

const OURS_MARKER = '<<<<<<< HEAD';
const BASE_MARKER = '||||||| merged common ancestors';
const SEPARATOR_MARKER = '=======';
const THEIRS_MARKER = '>>>>>>> feature';

const SHARED_HEAD = ['export const shared = 1;', ''];

// Each side carries its own pre-existing violation (a Semgrep one on ours, a
// Node-checker one on theirs), so a resolution that keeps either side, or
// both, proves the baseline is the union of the two sides.
const OURS_SIDE = [
  "export const pickLabel = (kind: 'a' | 'b'): string => {",
  '  switch (kind) {',
  "    case 'a':",
  "      return 'A';",
  '    default:',
  "      return 'B';",
  '  }',
  '};',
];

const THEIRS_SIDE = ["export const err = 'failed';"];

const BASE_SIDE = ['export const tmp = 0;'];

const SHARED_TAIL = ['', 'export const tail = 2;', ''];

const HISTORY_ID_COMMENT = '// T12 review round 3: this probe pins the regression the fix covers.';

function conflictedContent(options: { withBase: boolean }): string {
  const baseSection = options.withBase ? [BASE_MARKER, ...BASE_SIDE] : [];

  return [
    ...SHARED_HEAD,
    OURS_MARKER,
    ...OURS_SIDE,
    ...baseSection,
    SEPARATOR_MARKER,
    ...THEIRS_SIDE,
    THEIRS_MARKER,
    ...SHARED_TAIL,
  ].join('\n');
}

function resolvedContent(side: string[]): string {
  return [...SHARED_HEAD, ...side, ...SHARED_TAIL].join('\n');
}

const SECOND_OURS_SIDE = ["export const mode = 'light';"];

const SECOND_THEIRS_SIDE = ["export const mode = 'dark';"];

function conflictBlock(ours: string[], theirs: string[]): string[] {
  return [OURS_MARKER, ...ours, SEPARATOR_MARKER, ...theirs, THEIRS_MARKER];
}

// Two blocks: `first` and `second` are each either a whole conflict block
// or the lines it was resolved to.
function twoBlockContent(first: string[], second: string[]): string {
  return [...SHARED_HEAD, ...first, '', ...second, ...SHARED_TAIL].join('\n');
}

const FIRST_BLOCK = conflictBlock(OURS_SIDE, THEIRS_SIDE);

const SECOND_BLOCK = conflictBlock(SECOND_OURS_SIDE, SECOND_THEIRS_SIDE);

function withCrlf(text: string): string {
  return text.split('\n').join('\r\n');
}

function runGuard(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectDirectory: string,
): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDirectory },
  });
}

function denyReason(result: SpawnSyncReturns<string>): string {
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
}

const createdProjects: string[] = [];

// Writes `beforeContent` to src/probe/conflict.ts in a fresh temp project
// and returns that file's path.
function writeOnDiskFile(beforeContent: string): { project: string; targetFile: string } {
  const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-conflict-'));
  createdProjects.push(project);
  const targetDirectory = join(project, 'src', 'probe');
  mkdirSync(targetDirectory, { recursive: true });
  const targetFile = join(targetDirectory, 'conflict.ts');
  writeFileSync(targetFile, beforeContent);

  return { project, targetFile };
}

afterEach(() => {
  while (createdProjects.length > 0) {
    const project = createdProjects.pop();

    if (project) rmSync(project, { recursive: true, force: true });
  }
});

describe('pre-write guard on a file with git conflict markers (real semgrep)', () => {
  it('allows an Edit that resolves the conflict to the ours side', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));
    const conflictBlock = [
      OURS_MARKER,
      ...OURS_SIDE,
      SEPARATOR_MARKER,
      ...THEIRS_SIDE,
      THEIRS_MARKER,
    ].join('\n');

    const result = runGuard(
      'Edit',
      { file_path: targetFile, old_string: conflictBlock, new_string: OURS_SIDE.join('\n') },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a Write that resolves the conflict to the theirs side', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: resolvedContent(THEIRS_SIDE) },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a Write that keeps both sides', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: resolvedContent([...OURS_SIDE, ...THEIRS_SIDE]) },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a partial-resolution step that keeps the conflict markers', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));

    const result = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: 'export const tail = 2;',
        new_string: 'export const tail = 3;',
      },
      project,
    );

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('denies a resolution that adds a violation present on neither side, naming only that rule', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));

    const result = runGuard(
      'Write',
      {
        file_path: targetFile,
        content: resolvedContent([HISTORY_ID_COMMENT, ...OURS_SIDE, ...THEIRS_SIDE]),
      },
      project,
    );

    expect(result.status).toBe(2);
    const reason = denyReason(result);
    expect(reason).toContain('kiko-no-history-id-comment');
    expect(reason).not.toContain('kiko-no-switch');
    expect(reason).not.toContain('kiko-full-word-identifiers');
  });

  it('allows a diff3-style conflict resolved to the theirs side', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: true }));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: resolvedContent(THEIRS_SIDE) },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('denies a diff3-style resolution that keeps a violation found only in the base section', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: true }));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: resolvedContent(BASE_SIDE) },
      project,
    );

    expect(result.status).toBe(2);
    expect(denyReason(result)).toContain('kiko-full-word-identifiers');
  });

  // A violation added while a block stays would sit on BOTH sides of the
  // next step's baseline and pass the final resolution unseen, so the
  // marker-keeping step itself is checked, and the deny names the line in
  // the content the edit would write, not in a rebuilt side.
  it('denies a marker-keeping step that adds a violation in a shared region', () => {
    const beforeContent = conflictedContent({ withBase: false });
    const { project, targetFile } = writeOnDiskFile(beforeContent);
    const tailLine = beforeContent.split('\n').indexOf('export const tail = 2;') + 1;

    const result = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: 'export const tail = 2;',
        new_string: `${HISTORY_ID_COMMENT}\nexport const tail = 2;`,
      },
      project,
    );

    expect(result.status).toBe(2);
    const reason = denyReason(result);
    expect(reason).toContain('kiko-no-history-id-comment');
    expect(reason).toContain(`src/probe/conflict.ts:${tailLine}`);
    expect(reason).toContain('would add 1 new violation');
  });

  it('denies a marker-keeping step that edits a violation into one side', () => {
    const { project, targetFile } = writeOnDiskFile(conflictedContent({ withBase: false }));

    const result = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: THEIRS_SIDE[0],
        new_string: `${THEIRS_SIDE[0]}\nexport const tmp = 0;`,
      },
      project,
    );

    expect(result.status).toBe(2);
    expect(denyReason(result)).toContain('kiko-full-word-identifiers');
  });

  it('allows a step that resolves one block to theirs while another block stays', () => {
    const { project, targetFile } = writeOnDiskFile(twoBlockContent(FIRST_BLOCK, SECOND_BLOCK));

    const result = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: FIRST_BLOCK.join('\n'),
        new_string: THEIRS_SIDE.join('\n'),
      },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a full resolution of two blocks that takes ours for one and theirs for the other', () => {
    const { project, targetFile } = writeOnDiskFile(twoBlockContent(FIRST_BLOCK, SECOND_BLOCK));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: twoBlockContent(OURS_SIDE, SECOND_THEIRS_SIDE) },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a CRLF conflicted file resolved to the ours side', () => {
    const { project, targetFile } = writeOnDiskFile(
      withCrlf(conflictedContent({ withBase: false })),
    );

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: withCrlf(resolvedContent(OURS_SIDE)) },
      project,
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('checks a CRLF marker-keeping step', () => {
    const beforeContent = withCrlf(twoBlockContent(FIRST_BLOCK, SECOND_BLOCK));
    const { project, targetFile } = writeOnDiskFile(beforeContent);

    const clean = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: withCrlf(SECOND_BLOCK.join('\n')),
        new_string: SECOND_OURS_SIDE[0],
      },
      project,
    );
    const violating = runGuard(
      'Edit',
      {
        file_path: targetFile,
        old_string: withCrlf(SECOND_BLOCK.join('\n')),
        new_string: `${SECOND_OURS_SIDE[0]}\r\n${HISTORY_ID_COMMENT}`,
      },
      project,
    );

    expect(clean.stderr).toBe('');
    expect(clean.status).toBe(0);
    expect(violating.status).toBe(2);
    expect(denyReason(violating)).toContain('kiko-no-history-id-comment');
  });

  it('still denies an unparseable file on disk that has no conflict markers', () => {
    const { project, targetFile } = writeOnDiskFile(
      ['export const value = 1;', '', 'export function broken( {', '}', ''].join('\n'),
    );

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: 'export const value = 1;\n' },
      project,
    );

    expect(result.status).toBe(2);
    const reason = denyReason(result);
    expect(reason).toContain('src/probe/conflict.ts:3');
    expect(reason).toContain('the file as it is on disk');
    expect(reason).not.toContain('syntactically complete');
  });

  it('still denies a write that puts conflict markers into a file that had none', () => {
    const { project, targetFile } = writeOnDiskFile(resolvedContent(THEIRS_SIDE));

    const result = runGuard(
      'Write',
      { file_path: targetFile, content: conflictedContent({ withBase: false }) },
      project,
    );

    expect(result.status).toBe(2);
    expect(denyReason(result)).toContain('syntactically complete');
  });
});
