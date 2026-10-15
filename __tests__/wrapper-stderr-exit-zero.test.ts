import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// A hook that exits 0 does not feed its stderr back to the agent, so a wrapper that writes to
// stderr and then exits 0 in the same branch shows its message to nobody. kiko-linter's "The
// wrapper contract" lists the wrappers that do it on purpose; a new one fails here until the
// contract names it.
const CHECKS_DIRECTORY = join(__dirname, '../scripts/checks');
const LINTER_SKILL = join(__dirname, '..', '.claude/skills/kiko-linter/SKILL.md');

const WRITES_STDERR = />&2\b|^print_block\b/;
const EXITS_ZERO = /(^|[;&|{]\s*)exit 0\b/;
const BRANCH_END = /^(fi|esac|else|elif|\}|;;)/;

// Heuristic, line by line: a stderr write (a `>&2` redirect or a `print_block` call) followed by
// `exit 0` before the next branch end (`fi`, `else`, `}`, `;;`). It reads no quoting and no
// control flow, so a false hit is possible; the real scripts hold none today.
const exitsZeroAfterStderr = (script: string): number[] => {
  const hits: number[] = [];
  let stderrAt: number | undefined;

  script.split('\n').forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) return;

    if (BRANCH_END.test(trimmed)) stderrAt = undefined;

    if (WRITES_STDERR.test(trimmed)) stderrAt = index + 1;

    if (stderrAt !== undefined && EXITS_ZERO.test(trimmed)) {
      hits.push(stderrAt);
      stderrAt = undefined;
    }
  });

  return hits;
};

const PINNING_REFERENCE = '`__tests__/wrapper-stderr-exit-zero.test.ts`';

// Only the list item that states the exception list and cites this test counts: the section
// names many wrappers for other reasons, and a name there would pass a wrapper vacuously.
const exceptionParagraph = (skill: string): string => {
  const start = skill.indexOf('\n## The wrapper contract\n');
  const end = skill.indexOf('\n## ', start + 1);
  const section = skill.slice(start, end === -1 ? undefined : end);
  const paragraph = section
    .split('\n\n')
    .flatMap((block) => block.split(/\n(?=- )/))
    .find((item) => item.includes(PINNING_REFERENCE));

  if (paragraph === undefined) {
    throw new Error(`no paragraph of "The wrapper contract" cites ${PINNING_REFERENCE}`);
  }

  return paragraph;
};

const hitWrappers = (scripts: Record<string, string>): string[] =>
  Object.entries(scripts)
    .filter(([, script]) => exitsZeroAfterStderr(script).length > 0)
    .map(([name]) => name);

const undeclaredWrappers = (scripts: Record<string, string>, contract: string): string[] =>
  hitWrappers(scripts).filter((name) => !contract.includes(`\`${name}\``));

const repositoryScripts = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(CHECKS_DIRECTORY)
      .filter((name) => name.endsWith('.sh'))
      .map((name) => [name, readFileSync(join(CHECKS_DIRECTORY, name), 'utf8')]),
  );

describe('wrappers that write to stderr and exit 0', () => {
  const contract = exceptionParagraph(readFileSync(LINTER_SKILL, 'utf8'));

  it('are all named in the wrapper contract', () => {
    expect(undeclaredWrappers(repositoryScripts(), contract)).toEqual([]);
  });

  it('are named in the exception paragraph, not elsewhere in the section', () => {
    const skill = [
      '# Skill',
      '## The wrapper contract',
      '- A missing path names `other.sh` and `dup.sh` for another reason.',
      '- Exceptions: `dup.sh` writes to stderr. Pinned by',
      `  ${PINNING_REFERENCE}.`,
      '',
      'A later paragraph names `new-check.sh`.',
      '## Next section names `late.sh`',
    ].join('\n');
    const notice = 'echo "a notice" >&2\nexit 0\n';
    const scripts = { 'dup.sh': notice, 'other.sh': notice, 'new-check.sh': notice };

    expect(undeclaredWrappers(scripts, exceptionParagraph(skill))).toEqual([
      'other.sh',
      'new-check.sh',
    ]);
  });

  it('fails when no paragraph of the section cites this test', () => {
    const skill = '## The wrapper contract\n\nOnly `dup.sh` is named here.\n';

    expect(() => exceptionParagraph(skill)).toThrow('no paragraph of "The wrapper contract"');
  });

  it('still includes the wrappers the contract names, so the heuristic is not blind', () => {
    expect(hitWrappers(repositoryScripts())).toEqual(
      expect.arrayContaining(['dup.sh', 'medium.sh', 'security.sh']),
    );
  });

  it('reports a wrapper the contract does not name', () => {
    const notice = 'echo "a notice" >&2\nexit 0\n';

    expect(undeclaredWrappers({ 'new-check.sh': notice, 'dup.sh': notice }, contract)).toEqual([
      'new-check.sh',
    ]);
  });

  it.each([
    ['a redirect then exit 0', 'echo notice >&2\nexit 0\n', [1]],
    ['both on one line', '[ -z "$a" ] || { echo notice >&2; exit 0; }\n', [1]],
    ['a print_block then exit 0', 'print_block a b c d e f\nexit 0\n', [1]],
    ['an exit 0 after the branch ended', 'if x; then\n  echo n >&2\nfi\nexit 0\n', []],
    ['an exit 0 in the other branch', 'if x; then\n  echo n >&2\nelse\n  exit 0\nfi\n', []],
    ['an exit 2 after the write', 'echo n >&2\nexit 2\n', []],
    ['a commented write', '# echo n >&2\nexit 0\n', []],
    ['a write after the exit', 'exit 0\necho n >&2\n', []],
  ])('the heuristic reads %s', (_label, script, expected) => {
    expect(exitsZeroAfterStderr(script)).toEqual(expected);
  });
});
