import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// The heavy-job deny of scripts/checks/kill-guard.js: a whole-repository job (the verify, gate
// and deep targets of the Makefile, check:all, check:deep, check:mutation, their scripts, a
// check:security or security.sh run with no path, a Semgrep scan of the whole repository) takes
// minutes of CPU on a machine every other agent shares, so an agent queues it through
// scripts/job-queue.sh instead. The deny judges the typed command only: a script file that
// holds `make verify` is never read, and a quoted or echoed mention is text.
//
// Every text here is judged, never run: `decide` is called in node as a parser only. Each row is
// judged from a linked worktree, the main checkout and a folder outside the project.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const HEAVY_JOB = 'heavyJob';

const repository = createFakeRepository('guard-heavy-jobs-');
afterAll(removeTemporaryDirectories);

const { worktree: WORKTREE, main: MAIN } = repository;
const HOLDING_VERIFY = join(repository.scratch, 'holds-make-verify.sh');
writeFileSync(HOLDING_VERIFY, '#!/bin/bash\nmake verify\nnpm run check:all\n');

const DENIED_MAKE: string[] = [
  'make verify',
  'make gate',
  'make deep',
  'KIKO_MUTATION_BASE=abc make deep',
  `make -C ${WORKTREE} verify`,
  `make -C ${MAIN} deep`,
  `make -C ${WORKTREE} gate`,
  `cd ${WORKTREE} && make verify`,
  `(cd ${MAIN} && make deep)`,
  'timeout 600 make verify',
  'nohup make verify > out.log 2>&1 &',
  "sh -c 'make verify'",
  "bash -lc 'make deep'",
  'env -u FORCE_COLOR make verify',
  'nice -n 5 make verify',
  'time make verify',
  'make verify 2>&1 | tail -20',
  'echo start; make verify',
  'true && make deep',
  'eval "make verify"',
  'echo $(make verify)',
  // A glued value option holding the letter n is no dry run.
  'make -Iinclude verify',
  'make -Cnested verify',
  'make -Oline verify',
];

const DENIED_NPM_AND_SCRIPTS: string[] = [
  'npm run check:all',
  'npm run check:deep',
  'npm run check:mutation',
  `npm --prefix ${WORKTREE} run check:all`,
  `npm --prefix ${MAIN} run check:mutation`,
  'npm run check:all --silent',
  'npm run check:all 2>&1 | tail -20',
  `cd ${WORKTREE} && npm run check:deep`,
  "bash -c 'npm run check:all'",
  'KIKO_MUTATION_BASE=abc npm run check:mutation',
  'bash scripts/checks/verify.sh',
  `bash ${WORKTREE}/scripts/checks/verify.sh`,
  'sh scripts/checks/verify.sh',
  'bash scripts/checks/mutation.sh',
  `bash ${MAIN}/scripts/checks/mutation.sh`,
  'KIKO_MUTATION_BASE=abc bash scripts/checks/mutation.sh',
  `cd ${WORKTREE} && bash scripts/checks/verify.sh`,
  "bash -c 'bash scripts/checks/verify.sh'",
  'source scripts/checks/verify.sh',
  '. scripts/checks/security.sh',
  'source scripts/checks/mutation.sh',
];

// A security run with no path scans the whole repository, so it is a heavy job; a path after
// `--` (or after the script) names the file the caller means.
const DENIED_SECURITY_WITHOUT_PATH: string[] = [
  'npm run check:security',
  'npm run check:security --silent',
  'make security',
  `make -C ${WORKTREE} security`,
  `npm --prefix ${WORKTREE} run check:security`,
  'bash scripts/checks/security.sh',
  `bash ${WORKTREE}/scripts/checks/security.sh`,
  `cd ${WORKTREE} && bash scripts/checks/security.sh`,
  'npm run check:security 2>&1 | tail -20',
  'bash scripts/checks/security.sh .',
  'bash scripts/checks/security.sh ./',
  'bash scripts/checks/security.sh $PWD',
  'npm run check:security -- .',
];

// Every spelling of "the whole repository" as the target of a bare Semgrep scan, and no target
// at all (Semgrep then scans the folder it runs in).
const DENIED_WHOLE_REPOSITORY_SEMGREP: string[] = [
  'semgrep scan --config rules/semgrep-mobile.yml .',
  'semgrep scan --config rules/semgrep-mobile.yml ./',
  'semgrep scan --config rules/semgrep-mobile.yml $PWD',
  'semgrep scan --config rules/semgrep-mobile.yml "$PWD"',
  `semgrep scan --config rules/semgrep-mobile.yml \${PWD}`,
  `semgrep scan --config rules/semgrep-mobile.yml ${WORKTREE}`,
  `semgrep scan --config rules/semgrep-mobile.yml ${MAIN}/`,
  'semgrep --config rules/semgrep-mobile.yml',
  'semgrep scan --config rules/semgrep-mobile.yml --quiet',
  'semgrep scan --config auto',
  'semgrep scan',
  'npx semgrep scan --config auto .',
  'npx semgrep --config rules/semgrep-mobile.yml',
  'semgrep --config rules/semgrep-mobile.yml --config rules/semgrep-prewrite.yml .',
  `cd ${WORKTREE} && semgrep scan --config rules/semgrep-mobile.yml .`,
  "bash -c 'semgrep scan --config auto .'",
  'semgrep scan --config rules/semgrep-mobile.yml --json .',
];

const ALLOWED_AROUND_HEAVY_JOBS: string[] = [
  'make mutable',
  'make doc-suites',
  // A dry run prints the recipe and runs nothing.
  'make -n verify',
  'make -kn verify',
  'bash scripts/checks/mutation.sh --list',
  'echo make verify',
  'echo "npm run check:all"',
  'git commit -m "make verify"',
  "grep -rn 'make verify' docs/",
  "grep -rn 'check:deep' package.json",
  `bash scripts/job-queue.sh verify ${WORKTREE} label`,
  `bash scripts/job-queue.sh verify ${WORKTREE} label --sha abc1234 --scoped`,
  `bash scripts/job-queue.sh gate ${WORKTREE} label base head`,
  `bash scripts/job-queue.sh check-all ${WORKTREE} label`,
  `bash scripts/job-queue.sh security ${WORKTREE} label`,
  // Green at once: the queue script is exempt from the content scan (isQueueScript), so the new
  // class needs no deny-list change.
  `bash scripts/job-queue.sh harness-verify ${WORKTREE} label`,
  `caffeinate -i bash scripts/job-queue.sh harness-verify ${WORKTREE} label`,
  'bash scripts/job-queue.sh status',
  'bash scripts/job-queue.sh hold label',
  'bash scripts/job-queue.sh release',
  'KIKO_MUTATION_BASE=abc1234 make mutable',
  // The deny judges the typed command, so a script that holds a heavy job runs as typed.
  `bash ${HOLDING_VERIFY}`,
  'npm run check:rules',
  'npm run check:lint',
  'npm run check:typecheck',
  'bash scripts/checks/semgrep-rules.sh',
  'npm run check:security -- src/a.ts',
  'bash scripts/checks/security.sh src/a.ts',
  `bash scripts/checks/security.sh ${WORKTREE}/src/a.ts`,
  'semgrep scan --config rules/semgrep-mobile.yml src',
  // A boolean flag that prefixes a value option's name takes no word.
  'semgrep scan --config rules/semgrep-mobile.yml --json src/a.ts',
  'semgrep scan --config rules/semgrep-mobile.yml --time src/a.ts',
  'semgrep scan --config rules/semgrep-mobile.yml --sarif src',
  'semgrep scan --config rules/semgrep-mobile.yml ./src',
  'semgrep scan --config rules/semgrep-mobile.yml rules/fixtures',
  `semgrep scan --config rules/semgrep-mobile.yml ${WORKTREE}/src`,
  'semgrep --config rules/semgrep-mobile.yml src/a.ts',
  'semgrep --config rules/semgrep-mobile.yml src/a.ts src/b.ts',
  'npx semgrep --config auto src',
  'semgrep --version',
  'semgrep --help',
  'echo semgrep scan .',
  'git commit -m "semgrep scan ."',
];

describe('kill-guard heavy-job deny (parser only, fake repository)', () => {
  it.each([
    ...DENIED_MAKE,
    ...DENIED_NPM_AND_SCRIPTS,
    ...DENIED_SECURITY_WITHOUT_PATH,
    ...DENIED_WHOLE_REPOSITORY_SEMGREP,
  ])('denies in every folder: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual([HEAVY_JOB, HEAVY_JOB, HEAVY_JOB]);
  });

  it.each(ALLOWED_AROUND_HEAVY_JOBS)('allows in every folder: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(['allow', 'allow', 'allow']);
  });

  it('denies a Semgrep scan of the folder it runs in, spelled as that folder', () => {
    const verdicts = decideInEachFolder(
      repository,
      (folder) => `semgrep scan --config rules/semgrep-mobile.yml ${folder}`,
    );

    expect(verdicts.slice(0, 2)).toEqual([HEAVY_JOB, HEAVY_JOB]);
  });

  it('allows a Semgrep scan of a subfolder of the folder it runs in', () => {
    expect(
      decideInEachFolder(
        repository,
        (folder) => `semgrep scan --config rules/semgrep-mobile.yml ${folder}/src`,
      ),
    ).toEqual(['allow', 'allow', 'allow']);
  });
});

describe('scripts/checks/kill-guard.sh heavy-job deny (hook entry)', () => {
  const run = (command: string) =>
    spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ cwd: join(__dirname, '..'), tool_input: { command } }),
      encoding: 'utf8',
    });

  it('denies with the standard block and names the queue as the way out', () => {
    const result = run('make verify');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    const { hookSpecificOutput } = JSON.parse(result.stdout.trim());
    const reason: string = hookSpecificOutput.permissionDecisionReason;
    expect(hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:'].filter(
        (label) => !reason.includes(label),
      ),
    ).toEqual([]);
    expect(reason).toContain('scripts/job-queue.sh');
  });

  it('names the --sha and --scoped options of a queued verify', () => {
    const result = run('make verify');
    const reason: string = JSON.parse(result.stdout.trim()).hookSpecificOutput
      .permissionDecisionReason;

    expect(reason).toContain('a verify also takes --sha <commit> and --scoped');
  });

  it('allows a queued verify', () => {
    const result = run('bash scripts/job-queue.sh verify /tmp/worktree label');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
