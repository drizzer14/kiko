import { join } from 'node:path';
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const CHECKS_DIRECTORY = join(__dirname, '../../scripts/checks');

const SIBLING_REQUIRE = /require\(\s*'\.\/([^']+)'\s*\)/g;

const withExtension = (name: string): string => (name.endsWith('.js') ? name : `${name}.js`);

// Every sibling module a script pulls in through `require('./x')`, followed transitively, so a
// module the guard gains later is copied without a name written here.
function siblingModules(script: string, found: Set<string>): Set<string> {
  const source = readFileSync(join(CHECKS_DIRECTORY, script), 'utf8');

  for (const [, name] of source.matchAll(SIBLING_REQUIRE)) {
    const sibling = withExtension(name);

    if (!found.has(sibling)) {
      found.add(sibling);
      siblingModules(sibling, found);
    }
  }

  return found;
}

// Copies the real kill-guard.sh, kill-guard.js and every module kill-guard.js requires into
// `<root>/scripts/checks`, so a disposable repository runs the exact hook the project wires.
// `omit` leaves named files out, for a row that proves a missing module is a deny.
export function copyKillGuard(repositoryRoot: string, omit: readonly string[] = []): string {
  const destination = join(repositoryRoot, 'scripts', 'checks');
  mkdirSync(destination, { recursive: true });

  for (const name of [
    'kill-guard.sh',
    ...siblingModules('kill-guard.js', new Set(['kill-guard.js'])),
  ]) {
    if (!omit.includes(name)) {
      copyFileSync(join(CHECKS_DIRECTORY, name), join(destination, name));
    }
  }
  chmodSync(join(destination, 'kill-guard.sh'), 0o755);

  return destination;
}
