import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const createdPaths: string[] = [];

export const trackTemporaryPath = (path: string): void => {
  createdPaths.push(path);
};

export const createTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  trackTemporaryPath(directory);

  return directory;
};

// Call from an afterEach: a test that throws mid-way still leaves nothing behind.
export const removeTemporaryDirectories = (): void => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop();

    if (path) rmSync(path, { recursive: true, force: true });
  }
};
