import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { warmExecutables } from './warm-executables';
import { writeExecutable } from './mutation-repository';
import { createTemporaryDirectory, removeTemporaryDirectories } from './temporary-directory';

afterEach(() => {
  delete process.env.KIKO_WARM_TEST;
  removeTemporaryDirectories();
});

const loggingStub = (directory: string, name: string, exitStatus = 0): string =>
  writeExecutable(
    join(directory, name),
    [
      '#!/usr/bin/env bash',
      `printf '${name} [%s]\\n' "\${KIKO_WARM_TEST-}" >> '${join(directory, 'log')}'`,
      `exit ${exitStatus}`,
      '',
    ].join('\n'),
  );

describe('warmExecutables', () => {
  it('runs each executable once, in order, with no arguments', () => {
    const directory = createTemporaryDirectory('kiko-warm-test-');

    warmExecutables([loggingStub(directory, 'first'), loggingStub(directory, 'second')]);

    expect(readFileSync(join(directory, 'log'), 'utf8')).toBe('first []\nsecond []\n');
  });

  it('hands the executable none of the test process environment', () => {
    process.env.KIKO_WARM_TEST = 'leaked';
    const directory = createTemporaryDirectory('kiko-warm-test-');

    warmExecutables([loggingStub(directory, 'only')]);

    expect(readFileSync(join(directory, 'log'), 'utf8')).toBe('only []\n');
  });

  it('goes on after an executable that fails', () => {
    const directory = createTemporaryDirectory('kiko-warm-test-');

    warmExecutables([loggingStub(directory, 'broken', 1), loggingStub(directory, 'after')]);

    expect(readFileSync(join(directory, 'log'), 'utf8')).toBe('broken []\nafter []\n');
  });
});
