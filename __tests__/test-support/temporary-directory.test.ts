import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { createTemporaryDirectory, removeTemporaryDirectories } from './temporary-directory';

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
  it('removes every directory created so far, with its content', () => {
    const first = createTemporaryDirectory('kiko-helper-test-');
    const second = createTemporaryDirectory('kiko-helper-test-');
    writeFileSync(join(first, 'file.txt'), 'content');

    removeTemporaryDirectories();

    expect([first, second].map((path) => existsSync(path))).toEqual([false, false]);
  });

  it('forgets a directory once removed, so a second call leaves a path made later alone', () => {
    const directory = createTemporaryDirectory('kiko-helper-test-');
    removeTemporaryDirectories();
    mkdirSync(directory);

    removeTemporaryDirectories();

    expect(existsSync(directory)).toBe(true);
    rmSync(directory, { recursive: true });
  });

  it('skips a directory that is already gone', () => {
    const directory = createTemporaryDirectory('kiko-helper-test-');
    rmSync(directory, { recursive: true });

    expect(() => removeTemporaryDirectories()).not.toThrow();
  });
});
