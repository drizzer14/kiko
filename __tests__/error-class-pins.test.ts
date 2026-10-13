import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { repositoryFiles } from './test-support/repository-files';

// A class that extends Error sets `this.name` and passes `super` a message, and a mutant that
// blanks either one survives unless a test pins the exact literal. So every such class needs a
// colocated test (same folder) that asserts its `.name` on the class's own literal and its
// `.message`, both in one file. A class with an empty body inherits both from Error and has no
// literal to pin.
const REPOSITORY_ROOT = join(__dirname, '..');

const ERROR_CLASS_PATTERN = /\bclass (\w+) extends Error\s*\{(\s*\})?/g;

const isSourceFile = (file: string): boolean =>
  file.startsWith('src/') && /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file);

const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file);

const folderOf = (file: string): string => file.slice(0, file.lastIndexOf('/'));

const errorClassesIn = (source: string): string[] =>
  [...source.matchAll(ERROR_CLASS_PATTERN)]
    .filter(([, , emptyBody]) => emptyBody === undefined)
    .map(([, className]) => className);

const pinsName = (testSource: string, className: string): boolean =>
  new RegExp(`\\.name\\)\\.(toBe|toEqual)\\(\\s*'${className}'|\\bname:\\s*'${className}'`).test(
    testSource,
  );

const pinsMessage = (testSource: string): boolean =>
  /\.message\)\.(toBe|toEqual|toMatch|toContain)\(|\bmessage:\s*['"`]/.test(testSource);

const isPinned = (className: string, testSources: string[]): boolean =>
  testSources.some((source) => pinsName(source, className) && pinsMessage(source));

describe('errorClassesIn', () => {
  it('lists a class with a constructor body', () => {
    expect(errorClassesIn('export class OneError extends Error {\n  constructor() {}\n}')).toEqual([
      'OneError',
    ]);
  });

  it('lists every class in a file', () => {
    expect(
      errorClassesIn(
        'export class OneError extends Error {\n  x = 1;\n}\nclass TwoError extends Error { y = 2; }',
      ),
    ).toEqual(['OneError', 'TwoError']);
  });

  it('skips a class with an empty body, which has no literal to pin', () => {
    expect(errorClassesIn('export class EmptyError extends Error {}')).toEqual([]);
    expect(errorClassesIn('export class EmptyError extends Error {\n}')).toEqual([]);
  });

  it('skips a class that extends another class', () => {
    expect(errorClassesIn('class ChildError extends ParentError { x = 1; }')).toEqual([]);
  });
});

describe('isPinned', () => {
  const pinned = [
    "it('x', () => {\n  expect(new OneError().name).toBe('OneError');\n" +
      "  expect(new OneError().message).toBe('text');\n});",
  ];

  it('accepts a test that pins the name and the message', () => {
    expect(isPinned('OneError', pinned)).toBe(true);
  });

  it('accepts a name given as an object field next to a message field', () => {
    expect(
      isPinned('OneError', ["expect(error).toMatchObject({ name: 'OneError', message: 'text' });"]),
    ).toBe(true);
  });

  it('rejects a test that pins the message of the class but not its name', () => {
    expect(isPinned('OneError', ["expect(new OneError().message).toBe('text');"])).toBe(false);
  });

  it('rejects a test that pins the name but not the message', () => {
    expect(isPinned('OneError', ["expect(new OneError().name).toBe('OneError');"])).toBe(false);
  });

  it('rejects a name pin on another class', () => {
    expect(
      isPinned(
        'OneError',
        pinned.map((source) => source.replaceAll('OneError', 'Other')),
      ),
    ).toBe(false);
  });

  it('rejects an instanceof check, which pins neither', () => {
    expect(isPinned('OneError', ['expect(error).toBeInstanceOf(OneError);'])).toBe(false);
  });

  it('rejects a name pin in one file and a message pin in another', () => {
    expect(
      isPinned('OneError', [
        "expect(new OneError().name).toBe('OneError');",
        "expect(new OneError().message).toBe('text');",
      ]),
    ).toBe(false);
  });
});

describe('every class that extends Error under src/', () => {
  const files = repositoryFiles(REPOSITORY_ROOT);
  const errorClasses = files.filter(isSourceFile).flatMap((file) =>
    errorClassesIn(readFileSync(join(REPOSITORY_ROOT, file), 'utf8')).map((className) => ({
      file,
      className,
    })),
  );

  it('finds the classes it is meant to check', () => {
    expect(errorClasses.map(({ className }) => className)).toContain('DatabaseKeyMissingError');
  });

  it.each(errorClasses.map(({ file, className }) => [className, file]))(
    '%s has a colocated test pinning its name and its message (%s)',
    (className, file) => {
      const testSources = files
        .filter((candidate) => isTestFile(candidate) && folderOf(candidate) === folderOf(file))
        .map((candidate) => readFileSync(join(REPOSITORY_ROOT, candidate), 'utf8'));

      expect(isPinned(className, testSources)).toBe(true);
    },
  );
});
