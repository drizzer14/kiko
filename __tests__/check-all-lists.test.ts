import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// `check:all` is stated three times: package.json runs it, CLAUDE.md lists it, and the Stop and
// PostToolUse hooks (medium.sh, fast.sh) run the same wrappers. A check added to one and missed in
// another leaves a gate that CLAUDE.md promises and nothing runs. Every expectation below is
// derived from those files, never hand-listed here.
const REPOSITORY_ROOT = join(__dirname, '..');

const CLAUDE_CHECK_ALL_LIST =
  /`npm run check:all` — the fast \+ medium tier checks, in order:\s+([^.]+)\./;

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const packageScripts = (): Record<string, string> =>
  (JSON.parse(readRepositoryFile('package.json')) as { scripts: Record<string, string> }).scripts;

const packageCheckAll = (): string[] =>
  packageScripts()
    ['check:all'].split(' && ')
    .map((step) => step.replace(/^npm run check:/, ''));

const claudeCheckAll = (): string[] =>
  (CLAUDE_CHECK_ALL_LIST.exec(readRepositoryFile('CLAUDE.md'))?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .split(', ')
    .filter((name) => name !== '');

// The wrapper a check name runs, such as `override-guard` for `overrides`.
const wrapperOf = (check: string): string =>
  /^bash scripts\/checks\/([\w-]+)\.sh$/.exec(packageScripts()[`check:${check}`] ?? '')?.[1] ?? '';

// The leading letter skips `source "$DIR/_lib.sh"`, which is the shared helper, not a check.
const wrappersRunBy = (hook: string): string[] =>
  [...readRepositoryFile(`scripts/checks/${hook}`).matchAll(/"\$DIR\/([a-z][\w-]*)\.sh"/g)].map(
    (match) => match[1],
  );

// A guard rule's `projectCheck` is the gate its deny points at when the finding was already in the
// file; the same rule runs at write time, so that check needs no hook of its own.
const checksRunAtWriteTime = (): string[] =>
  [
    ...readRepositoryFile('scripts/checks/pre-write-guard.js').matchAll(
      /projectCheck: 'check:([\w-]+)'/g,
    ),
  ].map((match) => match[1]);

const tierOf = (check: string): string => {
  const wrapper = wrapperOf(check);

  if (wrappersRunBy('fast.sh').includes(wrapper)) {
    return 'fast';
  }

  if (wrappersRunBy('medium.sh').includes(wrapper)) {
    return 'medium';
  }

  return checksRunAtWriteTime().includes(check) ? 'write-time' : 'none';
};

describe('the check:all list', () => {
  it('is the same, in the same order, in package.json and in CLAUDE.md', () => {
    expect(packageCheckAll().length).toBeGreaterThan(0);
    expect(claudeCheckAll()).toEqual(packageCheckAll());
  });

  it.each(packageCheckAll())('CLAUDE.md has a checks table row for check:%s', (check) => {
    expect(readRepositoryFile('CLAUDE.md')).toContain(`| \`npm run check:${check}\``);
  });

  it.each(packageCheckAll())('check:%s has a wrapper script that exists', (check) => {
    expect(wrapperOf(check)).not.toBe('');
    expect(() => readRepositoryFile(`scripts/checks/${wrapperOf(check)}.sh`)).not.toThrow();
  });

  it('runs every check in the fast tier, the medium tier, or at write time', () => {
    const unrun = packageCheckAll().filter((check) => tierOf(check) === 'none');

    expect(unrun).toEqual([]);
  });

  it('holds every wrapper fast.sh and medium.sh run', () => {
    const allWrappers = packageCheckAll().map(wrapperOf);
    const hookOnly = [...wrappersRunBy('fast.sh'), ...wrappersRunBy('medium.sh')].filter(
      (wrapper) => !allWrappers.includes(wrapper),
    );

    expect(hookOnly).toEqual([]);
  });

  it('reads the hooks and the guard (a stale pattern would prove nothing)', () => {
    expect(wrappersRunBy('fast.sh').length).toBeGreaterThan(0);
    expect(wrappersRunBy('medium.sh').length).toBeGreaterThan(0);
    expect(checksRunAtWriteTime().length).toBeGreaterThan(0);
  });
});
