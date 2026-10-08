#!/usr/bin/env node

// Mechanizes the pin-exact-dependency-versions rule: every dependencies,
// devDependencies, optionalDependencies, peerDependencies, and overrides
// entry (however deeply overrides nests, to scope an override to a
// parent/grandparent/... chain) must be an exact semver pin. This is an
// ALLOWLIST of the one spec shape npm resolves to a single version, not a
// denylist of range syntax — a denylist misses any range shape it does
// not already know about (a bare major/minor version, an empty spec, a
// tag like "latest", a git/github reference, ...) and can also
// misfire on an exact spec that merely contains a denylisted character
// (an exact prerelease identifier containing the letter x).

const fs = require('node:fs');

const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const isExactSpec = (spec) => typeof spec === 'string' && EXACT_SEMVER.test(spec);

// One recursive walk covers every checked block: dependencies and its
// siblings are always a flat { name: spec } map, but overrides nests to
// arbitrary depth, so the same walk has to recurse into a plain object
// value regardless of which top-level block it started from. Anything
// that is neither a string nor a plain object (a number, boolean, null,
// or array) is not a version spec npm can resolve, so it is a violation
// too.
const walk = (value, path, violations) => {
  if (typeof value === 'string') {
    if (!isExactSpec(value)) {
      violations.push({ path, spec: value });
    }

    return;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, nested] of Object.entries(value)) {
      walk(nested, `${path}.${name}`, violations);
    }

    return;
  }

  violations.push({ path, spec: JSON.stringify(value) });
};

const CHECKED_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
];

const findRangeSpecs = (packageJson) => {
  const violations = [];

  for (const block of CHECKED_BLOCKS) {
    const map = packageJson[block];

    if (map) {
      walk(map, block, violations);
    }
  }

  return violations;
};

function runCli() {
  const packageJsonPath = process.argv[2];

  if (!packageJsonPath) {
    process.stderr.write('usage: deps-ranges.js <path-to-package.json>\n');
    process.exit(2);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const violations = findRangeSpecs(packageJson);

  if (violations.length === 0) {
    process.exit(0);
  }

  for (const violation of violations) {
    process.stdout.write(`${violation.path}: ${violation.spec}\n`);
  }

  process.exit(1);
}

if (require.main === module) {
  runCli();
}
