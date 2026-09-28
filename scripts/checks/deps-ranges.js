#!/usr/bin/env node

// Mechanizes the pin-exact-dependency-versions rule: no range spec (^, ~,
// *, x, >, <, ||, or a space-separated range like "1.0.0 - 2.0.0") in
// package.json's dependencies, devDependencies, or overrides blocks — every
// spec must be the exact version npm already resolves. A hand-rolled
// scanner over the parsed manifest, not Semgrep: this is a JSON-shape rule
// (walk two named object blocks, and one level into a nested override
// object), not a source-code pattern Semgrep matches against.

const fs = require('node:fs');

// Any of these appearing in a spec string means it is a RANGE, not an
// exact version: ^ ~ * (caret/tilde/wildcard ranges), x/X (an npm
// "1.2.x" partial-wildcard range), < > (comparator ranges), || (an
// alternation of ranges), or any whitespace (a space-separated range like
// "1.0.0 - 2.0.0", or an npm "1.2.3 <2.0.0" comparator range).
const RANGE_INDICATOR = /[\^~*<>]|[xX]|\|\||\s/;

const isRangeSpec = (spec) => typeof spec === 'string' && RANGE_INDICATOR.test(spec);

// The nested shape of one override entry: `{ "parent": { "dep": "spec" } }`,
// npm's syntax for scoping an override to a specific parent package.
const findNestedOverrideViolations = (parentName, nestedOverrides) => {
  const violations = [];

  for (const [nestedName, nestedSpec] of Object.entries(nestedOverrides)) {
    if (isRangeSpec(nestedSpec)) {
      violations.push({ block: `overrides.${parentName}`, name: nestedName, spec: nestedSpec });
    }
  }

  return violations;
};

// `overrides` may nest one level (see `findNestedOverrideViolations`)
// alongside plain `{ "dep": "spec" }` entries — both shapes are checked.
const findOverrideViolations = (overrides) => {
  const violations = [];

  for (const [name, value] of Object.entries(overrides)) {
    if (typeof value === 'string') {
      if (isRangeSpec(value)) {
        violations.push({ block: 'overrides', name, spec: value });
      }

      continue;
    }

    if (value && typeof value === 'object') {
      violations.push(...findNestedOverrideViolations(name, value));
    }
  }

  return violations;
};

const findRangeSpecs = (packageJson) => {
  const violations = [];

  for (const block of ['dependencies', 'devDependencies']) {
    const map = packageJson[block];

    if (!map) {
      continue;
    }

    for (const [name, spec] of Object.entries(map)) {
      if (isRangeSpec(spec)) {
        violations.push({ block, name, spec });
      }
    }
  }

  if (packageJson.overrides) {
    violations.push(...findOverrideViolations(packageJson.overrides));
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
    process.stdout.write(`${violation.block}.${violation.name}: ${violation.spec}\n`);
  }

  process.exit(1);
}

if (require.main === module) {
  runCli();
}
