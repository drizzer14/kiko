import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { repositoryFiles } from './test-support/repository-files';

// A class that extends Error sets `this.name` and passes `super` a message, and a mutant that
// blanks either one survives unless a test pins the exact literal. So every such class needs a
// colocated test (same folder) that asserts its `.name` on the class's own literal and its
// `.message`. The message pin is asserted on the same receiver as the `.name` pin in the same
// `it` block, in the same `toMatchObject({ ... })` literal, or on `new ClassName(...).message`.
// A class with an empty body inherits both from Error and has no literal to pin.
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

const MESSAGE_MATCHERS = '(?:toBe|toEqual|toMatch|toContain)';

// One `toMatchObject({ ... })` literal holding both fields: a `message:` field of a fixture
// payload elsewhere in the block must not count as the message pin.
const objectPinPattern = (className: string): RegExp =>
  new RegExp(
    `toMatchObject\\(\\{(?:[^{}]*\\bname:\\s*'${className}'[^{}]*\\bmessage:\\s*['"\`]|[^{}]*\\bmessage:\\s*['"\`][^{}]*\\bname:\\s*'${className}')`,
  );

const pinsName = (testSource: string, className: string): boolean =>
  new RegExp(
    `\\.name\\)\\.(toBe|toEqual)\\(\\s*'${className}'|toMatchObject\\(\\{[^{}]*\\bname:\\s*'${className}'`,
  ).test(testSource);

// A `.message` assertion in another `it` block can belong to another class, so the message pin
// must share the name pin's block or be made on `new ClassName(...)` itself.
const testBlocksOf = (testSource: string): string[] =>
  testSource.split(/^\s*(?=(?:it|test)(?:\.(?:each|skip|only|concurrent)\b[^\n]*)?\()/m);

const pinsMessageOfNewInstance = (testSource: string, className: string): boolean =>
  new RegExp(
    `new ${className}\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)\\.message\\)\\.${MESSAGE_MATCHERS}\\(`,
  ).test(testSource);

// The message must be asserted on the receiver whose `.name` the block pins, so a message pin on
// another instance or on `error.cause` in the same block does not count.
const pinsMessageOfNameReceiver = (block: string, className: string): boolean =>
  [...block.matchAll(new RegExp(`(\\w+)\\.name\\)\\.(?:toBe|toEqual)\\(\\s*'${className}'`, 'g'))]
    .map(([, receiver]) => receiver)
    .some((receiver) =>
      new RegExp(`\\b${receiver}\\.message\\)\\.${MESSAGE_MATCHERS}\\(`).test(block),
    );

const isPinned = (className: string, testSources: string[]): boolean =>
  testSources.some(
    (source) =>
      testBlocksOf(source).some(
        (block) =>
          pinsMessageOfNameReceiver(block, className) || objectPinPattern(className).test(block),
      ) ||
      (pinsName(source, className) && pinsMessageOfNewInstance(source, className)),
  );

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

  it('rejects a name pin in one it block and a message pin in another it block of the same file', () => {
    expect(
      isPinned('OneError', [
        "it('names it', () => {\n  expect(new OneError().name).toBe('OneError');\n});\n\n" +
          "it('words another', () => {\n  expect(new OtherError().message).toBe('text');\n});",
      ]),
    ).toBe(false);
  });

  it('accepts a message pin made on a new instance of the class in another it block', () => {
    expect(
      isPinned('OneError', [
        "it('words it', () => {\n  expect(new OneError(418, { a: f() }).message).toBe('text');\n});\n\n" +
          "it('names it', () => {\n  expect(new OneError().name).toBe('OneError');\n});",
      ]),
    ).toBe(true);
  });

  it('accepts a name pin and a message pin in one it block among others', () => {
    expect(
      isPinned('OneError', [
        "it('other', () => {\n  expect(new OtherError().message).toBe('text');\n});\n\n" +
          "it('pins it', () => {\n  const error = new OneError();\n" +
          "  expect(error.name).toBe('OneError');\n  expect(error.message).toBe('text');\n});",
      ]),
    ).toBe(true);
  });

  it('rejects a message pin on another receiver in the name pin block', () => {
    expect(
      isPinned('OneError', [
        "it('x', () => {\n  const error = new OneError();\n  expect(error.name).toBe('OneError');\n" +
          "  expect(new OtherError().message).toBe('text');\n});",
      ]),
    ).toBe(false);
  });

  it('rejects a message pin on the cause of the name pin receiver', () => {
    expect(
      isPinned('OneError', [
        "it('x', () => {\n  const error = new OneError();\n  expect(error.name).toBe('OneError');\n" +
          "  expect((error.cause as Error).message).toBe('text');\n});",
      ]),
    ).toBe(false);
  });

  it('rejects a message field of a fixture payload beside the name pin', () => {
    expect(
      isPinned('OneError', [
        "it('x', () => {\n  const payload = { message: 'boom' };\n  const error = new OneError(payload);\n" +
          "  expect(error.name).toBe('OneError');\n});",
      ]),
    ).toBe(false);
  });

  it.each(['it.skip', 'it.only', 'it.concurrent', 'test.skip', 'test.only', 'test.concurrent'])(
    'rejects a name pin in an it block and a message pin in a following %s block',
    (declaration) => {
      expect(
        isPinned('OneError', [
          "it('names it', () => {\n  const error = new OneError();\n  expect(error.name).toBe('OneError');\n});\n\n" +
            `${declaration}('words another', () => {\n  const error = new OtherError();\n` +
            "  expect(error.message).toBe('text');\n});",
        ]),
      ).toBe(false);
    },
  );

  it('accepts the message pin on the same receiver as the name pin', () => {
    expect(
      isPinned('OneError', [
        "it('x', () => {\n  const failure = new OneError();\n  expect(failure.name).toBe('OneError');\n" +
          "  expect(failure.message).toBe('text');\n});",
      ]),
    ).toBe(true);
  });

  it('accepts an object-literal name and message in one toMatchObject, in either order', () => {
    expect(
      isPinned('OneError', ["expect(error).toMatchObject({ message: 'text', name: 'OneError' });"]),
    ).toBe(true);
  });

  it('rejects a name field and a message field in different object literals', () => {
    expect(
      isPinned('OneError', [
        "expect(error).toMatchObject({ name: 'OneError' });\nconst payload = { message: 'boom' };",
      ]),
    ).toBe(false);
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
