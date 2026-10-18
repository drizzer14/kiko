import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// The patch comment in both patched files (patches/@stryker-mutator+jest-runner+8.7.1.patch).
// mutation.sh's preflight and the pin test grep for exactly this text.
export const PATCH_MARKER = 'kiko-patch: exact covering-test selection';

export const RUNNER_PACKAGE = '@stryker-mutator/jest-runner';

export const PATCHED_RUNNER_FILES = [
  'dist/src/jest-test-runner.js',
  'dist/src/jest-plugins/mixin-jest-environment.cjs',
] as const;

export const installedRunnerDirectory = (): string =>
  dirname(require.resolve(`${RUNNER_PACKAGE}/package.json`));

// A fixture project has no real node_modules, so the preflight would refuse every wrapper test.
// Writes the two files the preflight reads, each carrying the marker.
export const writePatchedJestRunner = (root: string): void => {
  for (const file of PATCHED_RUNNER_FILES) {
    const absolutePath = join(root, 'node_modules', RUNNER_PACKAGE, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `// ${PATCH_MARKER}\n`);
  }
};
