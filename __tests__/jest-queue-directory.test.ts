import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// A suite that runs scripts/job-queue.sh or scripts/ff-main.sh with no `env` option hands the child
// this process's own environment, and without a KIKO_QUEUE_DIR there the child would use the real
// shared queue, whose done.log ff-main.sh trusts. jest.config.js sets the variable before jest
// forks its workers, so even such a child gets a temporary queue folder.
describe('the jest queue directory', () => {
  it('reaches a child spawned with no env option, under the temporary folder', () => {
    const child = spawnSync('sh', ['-c', 'printf %s "$KIKO_QUEUE_DIR"'], { encoding: 'utf8' });

    expect(child.stdout.startsWith(`${tmpdir()}/`)).toBe(true);
  });
});
