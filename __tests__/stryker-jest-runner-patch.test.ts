import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import {
  PATCH_MARKER,
  RUNNER_PACKAGE,
  PATCHED_RUNNER_FILES,
  installedRunnerDirectory,
} from './test-support/stryker-jest-runner';
import { probeRunner } from './test-support/stryker-mutant-run-probe';

// Stryker's jest runner builds one testNamePattern regex per mutant, which times out from regex
// cost alone above a few hundred covering tests. The standing patch selects exactly the covering
// test ids with a Set instead. The runner class is not exported, so the patch edits the installed
// 8.7.1 files; these pins fail on any upgrade until the patch is re-made and re-checked.
const ROOT = join(__dirname, '..');
const PATCH_FILE = join(ROOT, 'patches', '@stryker-mutator+jest-runner+8.7.1.patch');
const SELECTED_GLOBAL = '__kikoStrykerSelectedTestIds__';

// The patch also depends on these two packages: jest-circus 29.7.0 for the fullName form,
// ROOT_DESCRIBE_BLOCK_NAME and the run_start order, and Stryker core 8.7.1 for passing the dry
// run's test.id as the mutant's testFilter. jest-circus is transitive, so only core is in
// package.json.
const COMPANION_PINS = [
  { name: '@stryker-mutator/core', version: '8.7.1' },
  { name: 'jest-circus', version: '29.7.0' },
] as const;

type TestNode = { type: 'test'; name: string; mode?: string; parent: DescribeNode };
type DescribeNode = {
  type: 'describeBlock';
  name: string;
  parent?: DescribeNode;
  children: (TestNode | DescribeNode)[];
};

describe('@stryker-mutator/jest-runner patch pin', () => {
  it('pins jest-runner to exactly 8.7.1 in package.json', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.devDependencies[RUNNER_PACKAGE]).toBe('8.7.1');
  });

  it('pins jest-runner to exactly 8.7.1 in package-lock.json', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

    expect(lock.packages[''].devDependencies[RUNNER_PACKAGE]).toBe('8.7.1');
    expect(lock.packages[`node_modules/${RUNNER_PACKAGE}`].version).toBe('8.7.1');
  });

  it('installs the 8.7.1 the patch was made for', () => {
    const installed = JSON.parse(
      readFileSync(join(installedRunnerDirectory(), 'package.json'), 'utf8'),
    );

    expect(installed.version).toBe('8.7.1');
  });

  it('pins Stryker core to exactly 8.7.1 in package.json', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(manifest.devDependencies['@stryker-mutator/core']).toBe('8.7.1');
  });

  it.each(COMPANION_PINS)('pins $name to exactly $version in package-lock.json', (pin) => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

    expect(lock.packages[`node_modules/${pin.name}`].version).toBe(pin.version);
  });

  it('pins Stryker core to exactly 8.7.1 in the package-lock.json root', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

    expect(lock.packages[''].devDependencies['@stryker-mutator/core']).toBe('8.7.1');
  });

  it.each(COMPANION_PINS)('installs $name $version, the one the patch was made for', (pin) => {
    const installed = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', pin.name, 'package.json'), 'utf8'),
    );

    expect(installed.version).toBe(pin.version);
  });

  it('ships patches/@stryker-mutator+jest-runner+8.7.1.patch carrying the marker for both files', () => {
    expect(existsSync(PATCH_FILE)).toBe(true);

    const patch = readFileSync(PATCH_FILE, 'utf8');

    expect(patch).toContain(PATCH_MARKER);

    for (const file of PATCHED_RUNNER_FILES) {
      expect(patch).toContain(file);
    }
  });

  it.each(PATCHED_RUNNER_FILES)('the installed %s carries the marker', (file) => {
    expect(readFileSync(join(installedRunnerDirectory(), file), 'utf8')).toContain(PATCH_MARKER);
  });
});

describe('patched mutantRun', () => {
  it('selects exactly the covering ids and builds no testNamePattern', () => {
    const call = probeRunner({
      method: 'mutantRun',
      testFilter: ['outer a', 'top b.c (d)+'],
      hitLimit: 100,
    });

    expect(call.testNamePattern).toBeUndefined();
    expect(call.selectedDuringRun).toEqual(['outer a', 'top b.c (d)+']);
  });

  it('clears the global after a successful run', () => {
    const call = probeRunner({ method: 'mutantRun', testFilter: ['outer a'], hitLimit: 100 });

    expect(call.rejected).toBe(false);
    expect(call.selectedAfterRun).toBe('undefined');
  });

  it('clears the global after a failing run, and the failure still propagates', () => {
    const call = probeRunner({
      method: 'mutantRun',
      testFilter: ['outer a'],
      hitLimit: 100,
      failing: true,
    });

    expect(call.rejected).toBe(true);
    expect(call.selectedDuringRun).toEqual(['outer a']);
    expect(call.selectedAfterRun).toBe('undefined');
  });

  it('falls back to no filter for a static mutant (undefined testFilter)', () => {
    const call = probeRunner({ method: 'mutantRun', hitLimit: 100 });

    expect(call.testNamePattern).toBeUndefined();
    expect(call.selectedDuringRun).toBe('undefined');
  });

  it('falls back to the original pattern for an empty testFilter', () => {
    const call = probeRunner({ method: 'mutantRun', testFilter: [], hitLimit: 100 });

    expect(call.testNamePattern).toBe('');
    expect(call.selectedDuringRun).toBe('undefined');
  });

  it('falls back to the regex when the hit-limit environment is not installed', () => {
    const call = probeRunner({ method: 'mutantRun', testFilter: ['a.b', 'c'] });

    expect(call.testNamePattern).toBe('(a\\.b)|(c)');
    expect(call.selectedDuringRun).toBe('undefined');
  });

  it('leaves the dry run unfiltered and drops a global leaked by a crashed earlier call', () => {
    const call = probeRunner({ method: 'dryRun', leftover: ['leaked id'] });

    expect(call.testNamePattern).toBeUndefined();
    expect(call.selectedDuringRun).toBe('undefined');
  });
});

describe('patched Stryker environment', () => {
  const runnerDirectory = installedRunnerDirectory();
  const { mixinJestEnvironment } = require(
    join(runnerDirectory, 'dist/src/jest-plugins/mixin-jest-environment.cjs'),
  );
  const messaging = require(join(runnerDirectory, 'dist/src/jest-plugins/messaging.cjs'));

  const describeBlock = (
    name: string,
    parent: DescribeNode | undefined,
    build: (self: DescribeNode) => (TestNode | DescribeNode)[],
  ): DescribeNode => {
    const self: DescribeNode = { type: 'describeBlock', name, parent, children: [] };
    self.children = build(self);

    return self;
  };

  const rootBlock = (build: (self: DescribeNode) => (TestNode | DescribeNode)[]): DescribeNode =>
    describeBlock('ROOT_DESCRIBE_BLOCK', undefined, build);

  const testNode = (name: string, parent: DescribeNode, mode?: string): TestNode => ({
    type: 'test',
    name,
    mode,
    parent,
  });

  class FakeEnvironment {
    global: Record<string, unknown> = {};
    static events: string[] = [];
    static lateTestName: string | undefined;
    async handleTestEvent(
      event: { name: string },
      state?: { rootDescribeBlock: DescribeNode },
    ): Promise<void> {
      FakeEnvironment.events.push(event.name);

      if (FakeEnvironment.lateTestName !== undefined && state !== undefined) {
        // Stands for the wrapped environment's own handler doing async work at run_start, after
        // a real asynchronous wait; a selection that ran before this await would never see the
        // test.
        await new Promise((resolve) => setImmediate(resolve));
        state.rootDescribeBlock.children.push(
          testNode(FakeEnvironment.lateTestName, state.rootDescribeBlock),
        );
      }
    }
  }

  const sendEvent = async (
    root: DescribeNode,
    selected: unknown,
    eventName = 'run_start',
  ): Promise<void> => {
    const Environment = mixinJestEnvironment(class extends FakeEnvironment {});
    const environment = new Environment({}, { testPath: '/fixture.test.ts' });

    if (selected !== undefined) {
      (globalThis as Record<string, unknown>)[SELECTED_GLOBAL] = selected;
    }

    try {
      await environment.handleTestEvent({ name: eventName }, { rootDescribeBlock: root });
    } finally {
      delete (globalThis as Record<string, unknown>)[SELECTED_GLOBAL];
    }
  };

  const modes = (root: DescribeNode): Record<string, string | undefined> => {
    const result: Record<string, string | undefined> = {};
    const walk = (block: DescribeNode, path: string[]): void => {
      for (const child of block.children) {
        if (child.type === 'describeBlock') {
          walk(child, [...path, child.name]);
        } else {
          result[[...path, child.name].join('|')] = child.mode;
        }
      }
    };
    walk(root, []);

    return result;
  };

  beforeEach(() => {
    FakeEnvironment.events = [];
    FakeEnvironment.lateTestName = undefined;
    messaging.state.coverageAnalysis = 'off';
  });

  it('skips every unselected test and keeps the selected ones, through nested describes', async () => {
    const root = rootBlock((top) => [
      describeBlock('outer', top, (outer) => [
        testNode('a', outer),
        testNode('b', outer),
        describeBlock('inner', outer, (inner) => [testNode('c', inner), testNode('d', inner)]),
      ]),
      testNode('top', top),
    ]);

    await sendEvent(root, new Set(['outer a', 'outer inner d', 'top']));

    expect(modes(root)).toEqual({
      'outer|a': undefined,
      'outer|b': 'skip',
      'outer|inner|c': 'skip',
      'outer|inner|d': undefined,
      top: undefined,
    });
  });

  it('builds the id like jestAdapterInit: ROOT_DESCRIBE_BLOCK and an empty title are dropped', async () => {
    const root = rootBlock((top) => [
      describeBlock('outer', top, (outer) => [
        testNode('', outer),
        describeBlock('ROOT_DESCRIBE_BLOCK', outer, (named) => [testNode('x', named)]),
        testNode('y', outer),
      ]),
    ]);

    await sendEvent(root, new Set(['outer', 'outer x']));

    expect(modes(root)).toEqual({
      'outer|': undefined,
      'outer|ROOT_DESCRIBE_BLOCK|x': undefined,
      'outer|y': 'skip',
    });
  });

  it('matches ids exactly: no regex, no case folding, no substring match, Unicode kept', async () => {
    const root = rootBlock((top) => [
      describeBlock('x y', top, (xy) => [testNode('', xy)]),
      testNode('X Y', top),
      describeBlock('a', top, (a) => [testNode('x y b', a)]),
      testNode('a.b (c)+ [d]', top),
      testNode('axb (c)+ [d]', top),
      testNode('Привіт, світе', top),
    ]);

    await sendEvent(root, new Set(['x y', 'a.b (c)+ [d]', 'Привіт, світе']));

    expect(modes(root)).toEqual({
      'x y|': undefined,
      'X Y': 'skip',
      'a|x y b': 'skip',
      'a.b (c)+ [d]': undefined,
      'axb (c)+ [d]': 'skip',
      'Привіт, світе': undefined,
    });
  });

  it('runs every test that shares a selected name', async () => {
    const root = rootBlock((top) => [
      testNode('same', top),
      testNode('same', top),
      testNode('other', top),
    ]);

    await sendEvent(root, new Set(['same']));

    expect(root.children.map((child) => (child as TestNode).mode)).toEqual([
      undefined,
      undefined,
      'skip',
    ]);
  });

  it('skips an unselected .only test, and leaves skipped and todo tests as they are', async () => {
    const root = rootBlock((top) => [
      testNode('only unselected', top, 'only'),
      testNode('only selected', top, 'only'),
      testNode('skipped selected', top, 'skip'),
      testNode('todo unselected', top, 'todo'),
    ]);

    await sendEvent(root, new Set(['only selected', 'skipped selected']));

    expect(modes(root)).toEqual({
      'only unselected': 'skip',
      'only selected': 'only',
      'skipped selected': 'skip',
      'todo unselected': 'todo',
    });
  });

  it.each(['off', 'perTest'])(
    'selects at run_start with %s coverage analysis',
    async (analysis) => {
      messaging.state.coverageAnalysis = analysis;
      const root = rootBlock((top) => [testNode('in', top), testNode('out', top)]);

      await sendEvent(root, new Set(['in']));

      expect(modes(root)).toEqual({ in: undefined, out: 'skip' });
    },
  );

  it('awaits the inner environment handler, then selects', async () => {
    const root = rootBlock((top) => [testNode('out', top)]);

    await sendEvent(root, new Set(['in']));

    expect(FakeEnvironment.events).toEqual(['run_start']);
    expect(modes(root)).toEqual({ out: 'skip' });
  });

  it('selects only after the inner handler finished: a test it adds late is seen', async () => {
    FakeEnvironment.lateTestName = 'added late';
    const root = rootBlock((top) => [testNode('in', top)]);

    await sendEvent(root, new Set(['in']));

    expect(modes(root)).toEqual({ in: undefined, 'added late': 'skip' });
  });

  it('changes nothing on any other event', async () => {
    const root = rootBlock((top) => [testNode('out', top)]);

    await sendEvent(root, new Set(['in']), 'test_start');

    expect(modes(root)).toEqual({ out: undefined });
  });

  it('changes nothing without the global, or when it is not a Set', async () => {
    const root = rootBlock((top) => [testNode('out', top)]);

    await sendEvent(root, undefined);
    await sendEvent(root, ['out']);

    expect(modes(root)).toEqual({ out: undefined });
  });
});
