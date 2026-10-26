import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// A suite that runs scripts/job-queue.sh or scripts/ff-main.sh with no KIKO_QUEUE_DIR of its own
// would read and write the real shared queue, whose done.log ff-main.sh trusts. jest/setup.js gives
// every worker a temporary queue folder, so that mistake lands in the temporary folder.
describe('the jest queue directory', () => {
  it('is a temporary folder', () => {
    const directory = process.env.KIKO_QUEUE_DIR as string;

    expect(directory.startsWith(`${tmpdir()}/`)).toBe(true);
  });

  it('is not the real queue of this machine', () => {
    expect(process.env.KIKO_QUEUE_DIR).not.toBe(join(homedir(), '.claude/kiko-queue'));
  });
});
