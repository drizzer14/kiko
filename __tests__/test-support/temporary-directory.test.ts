import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { existsSync, symlinkSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
  trackTemporaryPath,
} from './temporary-directory';

afterEach(() => {
  removeTemporaryDirectories();
});

describe('createTemporaryDirectory', () => {
  it('creates an existing directory under the system temporary directory with the prefix', () => {
    const directory = createTemporaryDirectory('kiko-helper-test-');

    expect(existsSync(directory)).toBe(true);
    expect(dirname(directory)).toBe(tmpdir());
    expect(basename(directory).startsWith('kiko-helper-test-')).toBe(true);
  });

  it('creates a different directory on every call', () => {
    expect(createTemporaryDirectory('kiko-helper-test-')).not.toBe(
      createTemporaryDirectory('kiko-helper-test-'),
    );
  });
});

describe('removeTemporaryDirectories', () => {
  it('removes every directory created so far and a tracked path', () => {
    const first = createTemporaryDirectory('kiko-helper-test-');
    const second = createTemporaryDirectory('kiko-helper-test-');
    const link = `${createTemporaryDirectory('kiko-helper-test-')}-link`;
    symlinkSync(first, link);
    trackTemporaryPath(link);

    removeTemporaryDirectories();

    expect([first, second, link].map((path) => existsSync(path))).toEqual([false, false, false]);
  });

  it('removes nothing the second time, so a repeated call is safe', () => {
    createTemporaryDirectory('kiko-helper-test-');

    removeTemporaryDirectories();

    expect(() => removeTemporaryDirectories()).not.toThrow();
  });
});
