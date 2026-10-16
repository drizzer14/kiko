import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// The first exec of a never-seen script on macOS waits on XProtect: about 0.3 s alone, seconds
// under jest fan-out. Running each stub once before a timed wait or poll starts moves that cost
// out of the bound. The run has an empty environment, so a stub that reads its sandbox variables
// finds none and does nothing; only pass a stub that is harmless that way.
export const warmExecutables = (paths: string[]): void => {
  for (const path of paths) {
    spawnSync(path, [], { cwd: tmpdir(), env: {}, stdio: 'ignore' });
  }
};
