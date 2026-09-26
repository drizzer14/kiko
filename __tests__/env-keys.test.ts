import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// A key declared in src/env.d.ts but missing from .env.example/.env.test
// would type-check yet read `undefined` at build/Jest time; a key present in
// one of those files but never declared would ship with no type safety and
// no ensure-env template comment. This invariant keeps all three in lockstep
// so a new @env key is never added to only one of them.
const ROOT = join(__dirname, '..');

const declaredEnvDtsKeys = (): Set<string> => {
  const content = readFileSync(join(ROOT, 'src/env.d.ts'), 'utf8');
  const keys = new Set<string>();
  for (const match of content.matchAll(/export const ([A-Z][A-Z0-9_]*):/g)) {
    keys.add(match[1]);
  }
  return keys;
};

const declaredEnvFileKeys = (fileName: string): Set<string> => {
  const content = readFileSync(join(ROOT, fileName), 'utf8');
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
};

describe('@env key declarations stay in lockstep', () => {
  it('src/env.d.ts, .env.example and .env.test declare the same key set', () => {
    const envDtsKeys = declaredEnvDtsKeys();
    const exampleKeys = declaredEnvFileKeys('.env.example');
    const testKeys = declaredEnvFileKeys('.env.test');

    expect([...exampleKeys].sort()).toEqual([...envDtsKeys].sort());
    expect([...testKeys].sort()).toEqual([...envDtsKeys].sort());
  });
});
