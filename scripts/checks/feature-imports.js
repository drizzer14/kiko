#!/usr/bin/env node

// Mechanizes the user's feature-import rule (B2): a folder whose subfolders
// are units with their own index.ts is a CONTAINER and each unit is a
// FEATURE; a plain folder is one feature with a root barrel. An import that
// crosses a feature boundary goes through the target feature's barrel —
// `@kiko/<feature>`, or `../<sibling>` between units of one non-screen
// container. The kiko-code-style skill states the rule; this file holds the
// declared classification, so it stays FS-free per file and works on the
// pre-write guard's mkdtemp mirror.
//
// A NODE check, not a Semgrep rule: deciding which feature a relative
// specifier lands in needs it resolved against the importing file's path.
//
// Modes: `<files…>` (exit 1 on findings), `--tree [srcRoot]` (layout
// checks that need the whole tree).

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PATTERNS, blankNoise, findSpecifiers } = require('./specifier-scanner');

const ROOT = path.resolve(__dirname, '..', '..');

// Mirrors tsconfig.json `paths`, babel.config.js `module-resolver`, and
// jest.config.js `moduleNameMapper`: `@kiko/*` is `src/*`.
const ALIAS_PREFIX = '@kiko/';

// Paths relative to src/. The src root itself is a container too: its
// plain folders (accounts, db, …) are features.
const CONTAINERS = new Set([
  'bank-sync',
  'bonds',
  'calendar',
  'categories',
  'crypto-sync',
  'currency',
  'design-system',
  'design-system/components',
  'holdings',
  'i18n',
  'loans',
  'migration',
  'monobank',
  'navigation',
  'prices',
  'rates',
  'screens',
  'screens/forms',
  'screens/settings',
  'statement-import',
  'statement-import/formats',
  'statistics',
  'sync',
  'transactions',
]);

// Screens never import each other with `../`, so these containers get no
// sibling exception.
const SCREEN_CONTAINERS = new Set(['screens', 'screens/forms', 'screens/settings']);

// Imported deep, and only by test files: a barrel that exported one would
// put test code in the App Store build (kiko-compliance 5.6).
const TEST_ONLY = [
  { path: 'test-support/**', reason: 'shared, ownerless test helpers; no barrel' },
  { path: '**/__fixtures__/**', reason: 'fixture data' },
  {
    path: 'db/in-array-clause-test-helper',
    reason: "query-shape helper for other features' repo tests",
  },
  {
    path: 'db/render-condition-test-helper',
    reason: "query-shape helper for other features' repo tests",
  },
  { path: 'db/capture-set-tx', reason: 'its only importers are tests' },
  { path: 'rates/monobank-feed-test-helper', reason: 'test-only feed builder' },
  { path: 'statement-import/formats/format-test-fixtures', reason: 'shared format test rows' },
  { path: 'i18n/locales/flatten-catalog', reason: 'catalog helper used only by i18n tests' },
  { path: 'i18n/locales/title-keys', reason: 'catalog helper used only by i18n tests' },
];

// Ambient declarations, never imported, so they stay loose at a container
// root.
const AMBIENT_LOOSE = new Set([
  'env.d.ts',
  'i18n/i18next.d.ts',
  'statement-import/windows-1251.d.ts',
]);

// Run on import, so each keeps one dedicated path that no other barrel
// re-exports; App.tsx imports them first, in this order.
const SIDE_EFFECT_MODULES = new Set(['design-system/unistyles', 'i18n/init']);

const FEATURE_PATTERNS = [
  ...DEFAULT_PATTERNS,
  {
    keyword: 'jest.',
    callKind: 'jest',
    pattern: /\bjest\.(?:doMock|unmock|requireActual|requireMock)\s*\(\s*['"]([^'"]+)['"]/g,
  },
];

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/^\*\*\//, '\u0001')
      .replace(/\/\*\*$/, '\u0002')
      .replace(/\*/g, '[^/]*')
      .replace('\u0001', '(?:.*/)?')
      .replace('\u0002', '(?:/.*)?')}$`,
  );

const TEST_ONLY_PATTERNS = TEST_ONLY.map((entry) => globToRegExp(entry.path));

const toPosix = (filePath) => filePath.split(path.sep).join('/');

const stripExtension = (filePath) => filePath.replace(/\.d\.ts$|\.tsx?$|\.js$/, '');

const isTestOnly = (sourceRelative) =>
  TEST_ONLY_PATTERNS.some((pattern) => pattern.test(sourceRelative));

const IN_SCOPE_FROM_ROOT = /^(?:(?:src|__tests__|e2e|jest)\/|App\.tsx$)/;

// The repo root a file belongs to. A file in this checkout uses ROOT, so a
// checkout that itself sits under a src/ folder still resolves. A guard
// mirror lies outside ROOT, so there the root is the path before the first
// src/, __tests__/, e2e/ or jest/ segment, or the folder of a root App.tsx.
function treeRootOf(filePath) {
  const absolute = toPosix(path.resolve(filePath));
  const checkoutRoot = toPosix(ROOT);

  if (absolute.startsWith(`${checkoutRoot}/`)) {
    return IN_SCOPE_FROM_ROOT.test(absolute.slice(checkoutRoot.length + 1)) ? checkoutRoot : null;
  }

  const match = /\/(?:src|__tests__|e2e|jest)\//.exec(absolute);

  if (match) {
    return absolute.slice(0, match.index);
  }

  return path.posix.basename(absolute) === 'App.tsx' ? path.posix.dirname(absolute) : null;
}

// The feature a src-relative path (no extension) lies in, and the container
// that feature is a unit of. A loose file at a container root is its own
// feature, named by its stem, so a specifier naming it keeps resolving once
// it moves into a unit folder. `feature` is null when the path IS a
// container.
function featureOf(sourceRelative) {
  let container = '';

  for (const segment of sourceRelative.split('/').filter(Boolean)) {
    const candidate = container === '' ? segment : `${container}/${segment}`;

    if (!CONTAINERS.has(candidate)) {
      return { container, feature: candidate };
    }

    container = candidate;
  }

  return { container, feature: null };
}

function isTestFile(root, absolute) {
  const relative = path.posix.relative(root, absolute);

  if (/\.test\.tsx?$/.test(relative) || /^(?:__tests__|e2e|jest)\//.test(relative)) {
    return true;
  }

  return relative.startsWith('src/') && isTestOnly(stripExtension(relative.slice(4)));
}

const isRelativeSpecifier = (specifier) =>
  specifier === '.' ||
  specifier === '..' ||
  specifier.startsWith('./') ||
  specifier.startsWith('../');

// The src-relative module path a specifier names (no extension, no
// trailing /index), or null for a bare package or a path outside src/.
function resolveTarget(root, absolute, specifier) {
  let sourceRelative;

  if (specifier.startsWith(ALIAS_PREFIX)) {
    sourceRelative = path.posix.normalize(specifier.slice(ALIAS_PREFIX.length));
  } else if (isRelativeSpecifier(specifier)) {
    const sourceRoot = `${root}/src`;
    const resolved = path.posix.resolve(path.posix.dirname(absolute), specifier);

    if (!resolved.startsWith(`${sourceRoot}/`)) {
      return null;
    }

    sourceRelative = resolved.slice(sourceRoot.length + 1);
  } else {
    return null;
  }

  return stripExtension(sourceRelative).replace(/(?:^|\/)index$/, '');
}

const withDotPrefix = (relative) => {
  if (relative === '') {
    return '.';
  }

  return relative.startsWith('.') ? relative : `./${relative}`;
};

function importerContext(filePath) {
  const absolute = toPosix(path.resolve(filePath));
  const root = treeRootOf(filePath);

  if (root === null) {
    return null;
  }

  const relative = path.posix.relative(root, absolute);
  const location = relative.startsWith('src/')
    ? featureOf(stripExtension(relative.slice(4)))
    : { container: null, feature: null };

  return {
    absolute,
    root,
    sourceRoot: `${root}/src`,
    feature: location.feature,
    container: location.container,
    isTest: isTestFile(root, absolute),
  };
}

// The src root is left out too: a top-level feature always reaches another
// through `@kiko/<feature>`, never `../<feature>`.
const inOpenContainerWith = (context, location) =>
  context.feature !== null &&
  location.container !== '' &&
  location.container === context.container &&
  !SCREEN_CONTAINERS.has(location.container);

const relativeFromImporter = (context, sourceRelative) =>
  withDotPrefix(
    path.posix.relative(
      path.posix.dirname(context.absolute),
      `${context.sourceRoot}/${sourceRelative}`,
    ),
  );

// Where a cross-feature import should point: `../<sibling>` (or `./` from a
// loose file) when the sibling exception allows it, else the alias barrel.
function barrelSuggestion(context, location) {
  if (location.feature === null) {
    return `a unit barrel under ${ALIAS_PREFIX}${location.container}`;
  }

  const importerDirectory = path.posix.dirname(context.absolute);
  const siblingName = path.posix.basename(location.feature);

  if (inOpenContainerWith(context, location)) {
    if (importerDirectory === `${context.sourceRoot}/${context.feature}`) {
      return `../${siblingName}`;
    }

    if (importerDirectory === `${context.sourceRoot}/${context.container}`) {
      return `./${siblingName}`;
    }
  }

  return `${ALIAS_PREFIX}${location.feature}`;
}

function describeTarget(context, entry) {
  const sourceRelative = resolveTarget(context.root, context.absolute, entry.specifier);

  if (sourceRelative === null) {
    return null;
  }

  const location = featureOf(sourceRelative);

  return {
    sourceRelative,
    location,
    testOnly: isTestOnly(sourceRelative),
    namesBarrel: location.feature !== null && sourceRelative === location.feature,
    relative: !entry.specifier.startsWith(ALIAS_PREFIX),
    jestCall: entry.callKind === 'jest',
  };
}

function classifyOwnFeature(context, target) {
  if (!target.relative) {
    return {
      kind: 'alias-into-own-feature',
      suggestion: relativeFromImporter(context, target.sourceRelative),
    };
  }

  if (!context.isTest && target.namesBarrel) {
    const mainFile = `${target.sourceRelative}/${path.posix.basename(target.sourceRelative)}`;

    return { kind: 'own-barrel', suggestion: relativeFromImporter(context, mainFile) };
  }

  return null;
}

function classifyRelative(context, target, specifier, suggestion) {
  const siblingShape = /^\.\.?\/[^/]+$/.test(specifier);

  if (
    !target.jestCall &&
    siblingShape &&
    target.namesBarrel &&
    inOpenContainerWith(context, target.location)
  ) {
    return null;
  }

  const betweenScreens =
    context.feature !== null &&
    target.location.feature !== null &&
    SCREEN_CONTAINERS.has(context.container) &&
    SCREEN_CONTAINERS.has(target.location.container);

  return {
    kind: betweenScreens ? 'relative-between-screens' : 'relative-leaves-feature',
    suggestion,
  };
}

// A test-only path has no barrel to go through.
const classifyAlias = (target, suggestion) =>
  target.namesBarrel || target.jestCall || target.testOnly
    ? null
    : { kind: 'alias-skips-barrel', suggestion };

// One specifier's verdict: a `{ kind, suggestion }` finding, or null when
// the import is allowed. A jest call keeps its resolved file, because Jest
// mocks by resolved file: a mock of a barrel never reaches the feature's
// own relative importers.
function classify(context, entry) {
  const target = describeTarget(context, entry);

  if (target === null) {
    return null;
  }

  if (target.testOnly && !context.isTest) {
    return { kind: 'test-only-from-production', suggestion: 'move the import into a test file' };
  }

  if (context.feature !== null && target.location.feature === context.feature) {
    return classifyOwnFeature(context, target);
  }

  const suggestion =
    target.testOnly || target.jestCall
      ? `${ALIAS_PREFIX}${target.sourceRelative}`
      : barrelSuggestion(context, target.location);

  return target.relative
    ? classifyRelative(context, target, entry.specifier, suggestion)
    : classifyAlias(target, suggestion);
}

function analyze(filePath, source) {
  const context = importerContext(filePath);

  if (context === null) {
    return [];
  }

  return findSpecifiers(source, FEATURE_PATTERNS).flatMap((entry) => {
    const verdict = classify(context, entry);

    return verdict === null
      ? []
      : [
          {
            line: entry.line,
            specifier: entry.specifier,
            kind: verdict.kind,
            suggestion: verdict.suggestion,
          },
        ];
  });
}

function findViolations(filePath, source) {
  return analyze(filePath, source).map((finding) => ({
    line: finding.line,
    matchedText: `${finding.specifier} [${finding.kind}]`,
    detailText: finding.suggestion,
  }));
}

// ---- tree mode ----

const isSourceFile = (name) => /\.tsx?$/.test(name);

function listDirectory(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  return {
    files: entries
      .filter((entry) => entry.isFile() && isSourceFile(entry.name))
      .map((entry) => entry.name),
    folders: entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => entry.name),
  };
}

function walkSourceFiles(directory) {
  const { files, folders } = listDirectory(directory);

  return [
    ...files.map((name) => path.join(directory, name)),
    ...folders.flatMap((name) => walkSourceFiles(path.join(directory, name))),
  ];
}

const joinRelative = (parent, name) => (parent === '' ? name : `${parent}/${name}`);

function looseFileFindings(directory, container, files) {
  return files
    .filter((name) => {
      const relative = joinRelative(container, name);

      return !AMBIENT_LOOSE.has(relative) && !isTestOnly(stripExtension(relative));
    })
    .map((name) => ({
      file: path.join(directory, name),
      kind: 'loose-file',
      detail: 'a container holds only unit folders; move it into its own unit folder',
    }));
}

// A unit folder with no files of its own whose production subfolders are
// all barrelled is a container the classification does not know about.
function unitFinding(unitDirectory, unit) {
  const listing = listDirectory(unitDirectory);
  const productionChildren = listing.folders.filter((child) => !isTestOnly(`${unit}/${child}`));
  const looksLikeContainer =
    listing.files.length === 0 &&
    productionChildren.length > 0 &&
    productionChildren.every((child) => fs.existsSync(path.join(unitDirectory, child, 'index.ts')));

  if (looksLikeContainer) {
    return {
      file: unitDirectory,
      kind: 'undeclared-container',
      detail: 'its subfolders are all barrelled units; declare it in CONTAINERS',
    };
  }

  if (!listing.files.includes('index.ts')) {
    return {
      file: unitDirectory,
      kind: 'missing-barrel',
      detail: 'a feature needs an index.ts barrel',
    };
  }

  return null;
}

function layoutFindings(sourceRoot) {
  return ['', ...CONTAINERS]
    .map((container) => ({ container, directory: path.join(sourceRoot, container) }))
    .filter(({ directory }) => fs.existsSync(directory))
    .flatMap(({ container, directory }) => {
      const { files, folders } = listDirectory(directory);
      const units = folders
        .map((name) => joinRelative(container, name))
        .filter((unit) => !CONTAINERS.has(unit) && !isTestOnly(unit));

      return [
        ...looseFileFindings(directory, container, files),
        ...units
          .map((unit) => unitFinding(path.join(sourceRoot, unit), unit))
          .filter((finding) => finding !== null),
      ];
    });
}

function leakReason(ownFeature, target) {
  const targetFeature = featureOf(target).feature;
  const reasons = [
    [/\.test$/.test(target), 'a test file'],
    [isTestOnly(target), 'a test-only path'],
    [
      SIDE_EFFECT_MODULES.has(targetFeature) && targetFeature !== ownFeature,
      'a foreign side-effect module',
    ],
    [targetFeature !== ownFeature, `the foreign feature ${targetFeature ?? target}`],
  ];

  return reasons.find(([applies]) => applies)?.[1] ?? null;
}

const IMPORT_CLAUSE = /^import\s+(?:type\s+)?([\s\S]*?)\s*\bfrom\b/;
const LOCAL_EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from\b)/g;
const DEFAULT_EXPORT_NAME = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|$)/gm;
const ALIAS_EXPORT_NAME =
  /\bexport\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=;]+)?=\s*([A-Za-z_$][\w$]*)\s*(?:;|$)/gm;

const withoutTypeModifier = (member) => member.trim().replace(/^type\s+/, '');

const listMembers = (list) => list.split(',').map(withoutTypeModifier).filter(Boolean);

// The local names an `import … from` statement binds, read from the
// noise-blanked statement so a comment inside the braces is not glued to
// the member after it.
function importedNames(entry) {
  const clause =
    entry.callKind === 'import' ? IMPORT_CLAUSE.exec(blankNoise(entry.statement)) : null;

  if (clause === null) {
    return [];
  }

  const braces = /\{([^}]*)\}/.exec(clause[1]);
  const named = braces === null ? [] : listMembers(braces[1]);
  const outside = listMembers(clause[1].replace(/\{[^}]*\}/, ''));

  return [...outside, ...named].map((member) => member.split(/\s+as\s+/).pop());
}

// The local names a barrel exports in a statement of their own
// (`export { b }`, `export default b`, `export const a = b`), read from the
// noise-blanked source so a commented-out export does not count.
function locallyExportedNames(source) {
  const blanked = blankNoise(source);
  const listed = [...blanked.matchAll(LOCAL_EXPORT_LIST)].flatMap((match) =>
    listMembers(match[1]).map((member) => member.split(/\s+as\s+/)[0]),
  );
  const named = [DEFAULT_EXPORT_NAME, ALIAS_EXPORT_NAME].flatMap((pattern) =>
    [...blanked.matchAll(pattern)].map((match) => match[1]),
  );

  return new Set([...listed, ...named]);
}

// What a barrel hands to its importers: its re-exports, any module it runs
// on load, and any binding it imports and then exports on its own line —
// the same re-export, written in two statements.
const handsOnToImporters = (exportedNames) => (entry) =>
  entry.callKind === 'export' ||
  /^import\s*['"]/.test(entry.statement) ||
  importedNames(entry).some((name) => exportedNames.has(name));

function barrelLeakFindings(sourceRoot, sourceFiles) {
  const root = path.posix.dirname(toPosix(path.resolve(sourceRoot)));

  return sourceFiles
    .filter((file) => path.basename(file) === 'index.ts')
    .map((file) => ({
      file,
      absolute: toPosix(path.resolve(file)),
      own: stripExtension(path.posix.relative(`${root}/src`, toPosix(path.resolve(file)))),
    }))
    .filter(({ own }) => !isTestOnly(own))
    .map((barrel) => ({ ...barrel, source: fs.readFileSync(barrel.file, 'utf8') }))
    .flatMap(({ file, absolute, own, source }) =>
      findSpecifiers(source, FEATURE_PATTERNS)
        .filter(handsOnToImporters(locallyExportedNames(source)))
        .flatMap((entry) => {
          const target = resolveTarget(root, absolute, entry.specifier);
          const reason = target === null ? null : leakReason(featureOf(own).feature, target);

          return reason === null
            ? []
            : [{ file, kind: 'barrel-leak', detail: `re-exports ${entry.specifier} (${reason})` }];
        }),
    );
}

const TYPE_ONLY_STATEMENT = /^(?:import|export)\s+type(?=[\s{*])/;
const BRACE_LIST_STATEMENT = /^(?:import|export)\s*\{([^}]*)\}\s*from/;

// Babel erases a type-only import, so it adds no edge to the require graph.
function isTypeOnly(entry) {
  if (TYPE_ONLY_STATEMENT.test(entry.statement)) {
    return true;
  }

  const braceList = BRACE_LIST_STATEMENT.exec(entry.statement);

  if (!braceList) {
    return false;
  }

  const members = braceList[1]
    .split(',')
    .map((member) => member.trim())
    .filter(Boolean);

  return members.length > 0 && members.every((member) => /^type\s/.test(member));
}

function valueImportedFeatures(context, source) {
  return findSpecifiers(source, FEATURE_PATTERNS)
    .filter((entry) => entry.callKind !== 'jest' && !isTypeOnly(entry))
    .map((entry) => resolveTarget(context.root, context.absolute, entry.specifier))
    .filter((target) => target !== null)
    .map((target) => featureOf(target).feature)
    .filter((feature) => feature !== null && feature !== context.feature);
}

function featureValueGraph(sourceFiles) {
  const graph = new Map();

  for (const file of sourceFiles) {
    const context = importerContext(file);

    if (context !== null && !context.isTest && context.feature !== null) {
      const edges = graph.get(context.feature) ?? new Set();

      for (const feature of valueImportedFeatures(context, fs.readFileSync(file, 'utf8'))) {
        edges.add(feature);
      }

      graph.set(context.feature, edges);
    }
  }

  return graph;
}

const neighboursOf = (graph, node) => [...(graph.get(node) ?? [])].sort();

function popComponent(state, node) {
  const component = [];
  let member;

  do {
    member = state.stack.pop();
    state.onStack.delete(member);
    component.push(member);
  } while (member !== node);

  return component.sort();
}

function strongConnect(graph, state, node) {
  state.indexOf.set(node, state.counter);
  state.lowLink.set(node, state.counter);
  state.counter += 1;
  state.stack.push(node);
  state.onStack.add(node);

  for (const next of neighboursOf(graph, node)) {
    if (!state.indexOf.has(next)) {
      strongConnect(graph, state, next);
      state.lowLink.set(node, Math.min(state.lowLink.get(node), state.lowLink.get(next)));
    } else if (state.onStack.has(next)) {
      state.lowLink.set(node, Math.min(state.lowLink.get(node), state.indexOf.get(next)));
    }
  }

  if (state.lowLink.get(node) === state.indexOf.get(node)) {
    state.components.push(popComponent(state, node));
  }
}

// Tarjan's strongly connected components.
function stronglyConnectedComponents(graph) {
  const state = {
    counter: 0,
    indexOf: new Map(),
    lowLink: new Map(),
    stack: [],
    onStack: new Set(),
    components: [],
  };

  for (const node of [...graph.keys()].sort()) {
    if (!state.indexOf.has(node)) {
      strongConnect(graph, state, node);
    }
  }

  return state.components;
}

// The shortest cycle through a component's first node, as a readable path.
function cyclePath(graph, component) {
  const members = new Set(component);
  const start = component[0];
  const parents = new Map([[start, null]]);
  const queue = [start];

  while (queue.length > 0) {
    const node = queue.shift();

    if (neighboursOf(graph, node).includes(start)) {
      const trail = [];

      for (let step = node; step !== null; step = parents.get(step)) {
        trail.unshift(step);
      }

      return [...trail, start].join(' -> ');
    }

    for (const next of neighboursOf(graph, node)) {
      if (members.has(next) && !parents.has(next)) {
        parents.set(next, node);
        queue.push(next);
      }
    }
  }

  return component.join(' -> ');
}

function findTreeViolations(sourceRoot) {
  const sourceFiles = walkSourceFiles(sourceRoot);
  const graph = featureValueGraph(sourceFiles);
  const cycles = stronglyConnectedComponents(graph)
    .filter((component) => component.length > 1)
    .map((component) => ({
      file: sourceRoot,
      kind: 'feature-cycle',
      detail: cyclePath(graph, component),
    }));

  return [...layoutFindings(sourceRoot), ...barrelLeakFindings(sourceRoot, sourceFiles), ...cycles];
}

// ---- CLI ----

function runTreeMode(sourceRoot) {
  const violations = findTreeViolations(sourceRoot ?? path.join(ROOT, 'src'));

  for (const violation of violations) {
    process.stdout.write(`${violation.file}: [${violation.kind}] ${violation.detail}\n`);
  }

  return violations.length > 0 ? 1 : 0;
}

function runCheckMode(files) {
  let anyViolation = false;

  for (const file of files) {
    for (const finding of analyze(file, fs.readFileSync(file, 'utf8'))) {
      anyViolation = true;
      process.stdout.write(
        `${file}:${finding.line}: ${finding.specifier} [${finding.kind}] -> ${finding.suggestion}\n`,
      );
    }
  }

  return anyViolation ? 1 : 0;
}

function runCli() {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === '--tree') {
    return runTreeMode(rest[0]);
  }

  if (mode === undefined) {
    process.stderr.write('usage: feature-imports.js <file...> | --tree [srcRoot]\n');

    return 2;
  }

  return runCheckMode(process.argv.slice(2));
}

// `process.exit` would cut off a large output still queued for a pipe.
if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = { findTreeViolations, findViolations };
