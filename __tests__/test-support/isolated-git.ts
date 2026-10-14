import { join } from 'node:path';

// The environment a test gives git inside a throwaway repository: HOME and the global config sit in
// the test's own folder and the system config is off, so no setting of the developer's machine
// (a global core.hooksPath, a signing key) reaches git, and the test cannot write to the real
// config. A GIT_* variable of the surrounding process (GIT_DIR from a running hook) is dropped.
export const isolatedGitEnvironment = (
  home: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  ...extra,
});
