import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// The edge rows the kill-guard rulings of the queue denies settled after the first rows were
// written (heavyJob and fullJest in kill-guard-heavy-jobs.test.ts and kill-guard-jest-runs.test.ts,
// docs/superpowers in kill-guard-docs-writes.test.ts). Every text is judged, never run.
const repository = createFakeRepository('guard-queue-edges-');
afterAll(removeTemporaryDirectories);

const EVERY_FOLDER = (kind: string): string[] => [kind, kind, kind];

describe('kill-guard queue denies: settled edge rows (parser only, fake repository)', () => {
  it.each(['make --dry-run verify', 'make --just-print verify', 'make --recon deep'])(
    'allows a dry run spelled as a long option, as it allows -n: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
    },
  );

  it('denies gmake like make: the same targets, so the same deny (fail closed)', () => {
    expect(decideInEachFolder(repository, 'gmake verify')).toEqual(EVERY_FOLDER('heavyJob'));
  });

  it('allows a Semgrep scan of a path outside the repository: it is no whole-repository scan', () => {
    expect(
      decideInEachFolder(
        repository,
        'semgrep scan --config rules/semgrep-mobile.yml /tmp/another-checkout/src',
      ),
    ).toEqual(EVERY_FOLDER('allow'));
  });

  it('denies npm test with only dash options after --: no test file is left', () => {
    expect(decideInEachFolder(repository, 'npm test -- --ci')).toEqual(EVERY_FOLDER('fullJest'));
  });

  // By analogy with the pinned `cp -r /tmp/kiko harness/` and `mv /tmp/skills .claude/`
  // (kill-guard-writes.test.ts): a folder named like the guarded tree lands inside it, whichever
  // way the destination is spelled. A relative destination names nothing of the project from a
  // folder outside it; `cp -r /tmp/x docs/` stays allowed everywhere.
  it('denies cp -r /tmp/superpowers docs/ like cp -r /tmp/kiko harness/', () => {
    expect(decideInEachFolder(repository, 'cp -r /tmp/superpowers docs/')).toEqual([
      'shellWrite',
      'shellWrite',
      'allow',
    ]);
  });

  it('allows cp -r /tmp/x docs/ where /tmp/superpowers is denied', () => {
    expect(decideInEachFolder(repository, 'cp -r /tmp/x docs/')).toEqual(EVERY_FOLDER('allow'));
  });
});
