import path from 'node:path';
import { readFileSync } from 'node:fs';

// `sf-symbols-typescript` is TYPE-ONLY (`dist/index.js` exports nothing), so
// its availability data is only readable as text. It is one `SFSymbolsN_M`
// union per release: the JSDoc above a union names the release
// (`@name SF Symbols 6.2`) and its minimum iOS (`iOS v18.2+,`), and every
// `  | 'name'` line below lists a symbol. The first union that lists a symbol
// is its release. The package is hoisted into node_modules by
// react-native-screens; a missing file fails the suite loudly.
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
const RELEASE_HEADER = /@name SF Symbols (\d+\.\d+)/;
const RELEASE_IOS = /^\s*\*\s*iOS v(\d+\.\d+)\+/;
const SYMBOL_LINE = /^\s*\|\s*'([^']+)'/;

export type SymbolCatalogue = {
  // Symbol name -> the `major.minor` iOS that introduced it.
  minimumIos: ReadonlyMap<string, string>;
  // Release (`6.2`) -> its `major.minor` iOS (`18.2`).
  releases: ReadonlyMap<string, string>;
};

export const parseSymbolCatalogue = (text: string): SymbolCatalogue => {
  const minimumIos = new Map<string, string>();
  const releases = new Map<string, string>();
  let release = '';
  let releaseIos = '';

  for (const line of text.split('\n')) {
    if (MERGED_UNION.test(line)) {
      break;
    }

    const header = RELEASE_HEADER.exec(line);
    const ios = RELEASE_IOS.exec(line);
    const symbol = SYMBOL_LINE.exec(line);

    if (header !== null) {
      release = header[1];
      releaseIos = '';
    } else if (ios !== null && releaseIos === '') {
      releaseIos = ios[1];
      releases.set(release, releaseIos);
    } else if (symbol !== null && releaseIos !== '' && !minimumIos.has(symbol[1])) {
      minimumIos.set(symbol[1], releaseIos);
    }
  }

  return { minimumIos, releases };
};

// The app's deployment target. Written out here, not imported from the
// fallback map, so the guard that checks the map does not trust the map.
const DEPLOYMENT_TARGET = [15, 1];

export const isNewerThanDeploymentTarget = (minimumIos: string): boolean => {
  const [major, minor] = minimumIos.split('.').map(Number);

  return (
    major > DEPLOYMENT_TARGET[0] || (major === DEPLOYMENT_TARGET[0] && minor > DEPLOYMENT_TARGET[1])
  );
};

export const symbolCatalogue: SymbolCatalogue = parseSymbolCatalogue(
  readFileSync(CATALOGUE_PATH, 'utf-8'),
);
