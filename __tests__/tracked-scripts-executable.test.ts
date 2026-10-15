import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// A tracked shell script or git hook runs by path (`bash` is not always the caller), so its index
// mode is 100755. The scope is the scripts, harness and githooks trees; `rules/fixtures/*.sh` are
// Semgrep inputs that are never run, so they stay mode 100644 and sit outside it.
const ROOT = join(__dirname, '..');
const EXECUTABLE_MODE = '100755';

const trackedEntries = (): Array<{ mode: string; path: string }> =>
  execFileSync('git', ['ls-files', '-s', '--', 'scripts/*.sh', 'harness/*.sh', 'githooks/*'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [mode, , , path] = row.split(/\s+/);

      return { mode, path };
    });

describe('tracked shell scripts and git hooks', () => {
  it('reads the scripts the queue and the checks run by path', () => {
    const paths = trackedEntries().map((entry) => entry.path);

    expect(paths).toContain('scripts/job-queue.sh');
    expect(paths).toContain('scripts/checks/medium.sh');
    expect(paths).toContain('githooks/pre-commit');
  });

  it('are all stored with mode 100755', () => {
    const notExecutable = trackedEntries()
      .filter((entry) => entry.mode !== EXECUTABLE_MODE)
      .map((entry) => `${entry.mode} ${entry.path}`);

    expect(notExecutable).toEqual([]);
  });
});
