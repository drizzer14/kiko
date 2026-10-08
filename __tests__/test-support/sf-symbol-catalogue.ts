import path from 'node:path';
import { readFileSync } from 'node:fs';

// `sf-symbols-typescript` is TYPE-ONLY (`dist/index.js` exports nothing), so
// its availability data is only readable as text. It is one `SFSymbolsN_M`
// union per release: the JSDoc above a union names the release
// (`@name SF Symbols 6.2`) and its minimum iOS (`iOS v18.2+,`), and every
// `  | 'name'` line below lists a symbol. The first union that lists a symbol
// is its release. The package is a transitive dependency (hoisted into
// node_modules by @react-navigation/native-stack and react-native-bottom-tabs),
// read here by path; a missing or reshaped file fails the suite loudly. See
// docs/harness/documented-exceptions.md.
const CATALOGUE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  'sf-symbols-typescript',
  'dist',
  'index.d.ts',
);

// The union that merges every release, after the last per-release one.
const MERGED_UNION = /^export type SFSymbol =/;
const RELEASE_HEADER = /@name SF Symbols \d+\.\d+/;
const RELEASE_IOS = /^\s*\*\s*iOS v(\d+\.\d+)\+/;
const SYMBOL_LINE = /^\s*\|\s*'([^']+)'/;

export type SymbolCatalogue = {
  // Symbol name -> the `major.minor` iOS that introduced it.
  minimumIos: ReadonlyMap<string, string>;
};

export const parseSymbolCatalogue = (text: string): SymbolCatalogue => {
  const minimumIos = new Map<string, string>();
  let releaseIos = '';

  for (const line of text.split('\n')) {
    if (MERGED_UNION.test(line)) {
      break;
    }

    const ios = RELEASE_IOS.exec(line);
    const symbol = SYMBOL_LINE.exec(line);

    if (RELEASE_HEADER.test(line)) {
      releaseIos = '';
    } else if (ios !== null && releaseIos === '') {
      releaseIos = ios[1];
    } else if (symbol !== null && releaseIos !== '' && !minimumIos.has(symbol[1])) {
      minimumIos.set(symbol[1], releaseIos);
    }
  }

  return { minimumIos };
};

// The app's deployment target: the ONE place the number is written for the
// tests. `deployment-target.test.ts` asserts every build file
// (`deployment-target.ts`) states this same iOS, so raising it is one edit here
// plus the build files, and a build file that drifts fails that test.
export const DEPLOYMENT_TARGET = '18.2';

const versionParts = (version: string): [number, number] => {
  const [major, minor = 0] = version.split('.').map(Number);

  return [major, minor];
};

export const isNewerThanDeploymentTarget = (minimumIos: string): boolean => {
  const [major, minor] = versionParts(minimumIos);
  const [targetMajor, targetMinor] = versionParts(DEPLOYMENT_TARGET);

  return major > targetMajor || (major === targetMajor && minor > targetMinor);
};

export const symbolCatalogue: SymbolCatalogue = parseSymbolCatalogue(
  readFileSync(CATALOGUE_PATH, 'utf-8'),
);
