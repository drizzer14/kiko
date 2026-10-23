import { join } from 'node:path';
import maybe, { foldMap } from 'fnts/maybe';

import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// The options of jest-cli that take one value (JEST_VALUE_OPTIONS of scripts/checks/kill-guard.js;
// the array options are pinned in kill-guard-jest-runs.test.ts): the word after one is its value,
// never a test path, so a jest run that holds only options and their values runs every suite. The
// options are read from jest-cli's own table, so a new one in a later jest-cli is a red row here
// instead of a silent hole in the guard.
const repository = createFakeRepository('guard-jest-options-');
afterAll(removeTemporaryDirectories);

type OptionSpecification = { type?: string; alias?: string };

const { options: JEST_CLI_OPTIONS } = require(
  join(__dirname, '../node_modules/jest-cli/build/args.js'),
) as { options: Record<string, OptionSpecification> };

const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const VALUE_OPTIONS = Object.entries(JEST_CLI_OPTIONS)
  .filter(([, { type }]) => type !== 'boolean' && type !== 'array')
  .flatMap(([name, specification]) => [
    `--${name}`,
    `--${kebabCase(name)}`,
    ...(foldMap(maybe(specification.alias), (alias) => [`-${alias}`]) ?? []),
  ]);

describe('kill-guard full-suite jest deny: options that take a value', () => {
  it('reads value options from jest-cli, the short forms of three of them included', () => {
    expect(VALUE_OPTIONS).toEqual(expect.arrayContaining(['--config', '-c', '-t', '-w']));
  });

  it.each(VALUE_OPTIONS)('denies %s and its value with no test path', (option) => {
    expect(decideInEachFolder(repository, `npx jest ${option} x`)).toEqual([
      'fullJest',
      'fullJest',
      'fullJest',
    ]);
  });

  it.each(VALUE_OPTIONS)('allows %s and its value beside a test path', (option) => {
    expect(decideInEachFolder(repository, `npx jest ${option} x src/a.test.ts`)).toEqual([
      'allow',
      'allow',
      'allow',
    ]);
  });
});
