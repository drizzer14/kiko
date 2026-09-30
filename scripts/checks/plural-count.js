#!/usr/bin/env node

// Mechanizes kiko-translator's "A plural key is always called with `count`".
// i18next picks the _one/_few/_many/_other form from the `count` option, so a
// plural key called without it matches no form and renders the bare key path
// on screen. tsc does not catch it: the catalogue type accepts the base key.
//
// This is a NODE check, not a Semgrep rule, because the plural key set lives
// in en.ts and a Semgrep rule cannot read a second file. The key set is read
// from THIS checkout's en.ts (the checker's own root), never from beside the
// checked file: the pre-write guard runs this checker on a temp mirror that
// holds only the one edited file.
//
// A base key K is plural when its object holds both `K_one` and `K_other`;
// keys are full dotted paths, so `statistics.trendFilter.manual` is not
// plural even though `statistics.trendFilter.button.manual` is. The callee is
// `t` or any `<object>.t` (`i18n.t`, `i18next.t`), and only a string-literal
// key is checked. An options argument the checker cannot see into (a
// variable, a spread, a computed name) may carry `count`, so it is never
// flagged: denying it would block code that is right today.

const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOGUE_PATH = path.join(ROOT, 'src', 'i18n', 'locales', 'en.ts');

// The catalogues define the keys and call no `t`; the checker never needs to
// read them as call sites.
const CATALOGUE_FILE = /(?:^|\/)src\/i18n\/locales\/(?:en|uk)\.ts$/;

const PLURAL_ONE_SUFFIX = /^(.+)_one$/;

function parse(filePath, source) {
  const scriptKind = filePath.endsWith('.tsx')
    ? typescript.ScriptKind.TSX
    : typescript.ScriptKind.TS;

  return typescript.createSourceFile(
    filePath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

// The literal text of a property name, or null for a computed name.
function propertyNameText(name) {
  if (
    typescript.isIdentifier(name) ||
    typescript.isStringLiteral(name) ||
    typescript.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

function joinKey(prefix, name) {
  return prefix === '' ? name : `${prefix}.${name}`;
}

function collectPluralKeys(objectLiteral, prefix, keys) {
  const names = new Set();

  for (const property of objectLiteral.properties) {
    if (!typescript.isPropertyAssignment(property)) continue;

    const name = propertyNameText(property.name);

    if (name === null) continue;

    names.add(name);

    if (typescript.isObjectLiteralExpression(property.initializer)) {
      collectPluralKeys(property.initializer, joinKey(prefix, name), keys);
    }
  }

  for (const name of names) {
    const match = PLURAL_ONE_SUFFIX.exec(name);

    if (match && names.has(`${match[1]}_other`)) {
      keys.add(joinKey(prefix, match[1]));
    }
  }
}

// Every plural base key in en.ts's `export const en = { ... }`. A catalogue
// this checker cannot find throws, so a moved or reshaped en.ts fails the
// check instead of silently disabling it.
function readPluralKeys(cataloguePath) {
  const sourceFile = parse(cataloguePath, fs.readFileSync(cataloguePath, 'utf8'));

  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        typescript.isIdentifier(declaration.name) &&
        declaration.name.text === 'en' &&
        declaration.initializer !== undefined &&
        typescript.isObjectLiteralExpression(declaration.initializer)
      ) {
        const keys = new Set();
        collectPluralKeys(declaration.initializer, '', keys);

        return keys;
      }
    }
  }

  throw new Error(`no \`const en = { ... }\` object literal in ${cataloguePath}`);
}

function isTranslateCallee(expression) {
  if (typescript.isIdentifier(expression)) {
    return expression.text === 't';
  }

  return typescript.isPropertyAccessExpression(expression) && expression.name.text === 't';
}

// False only when the options argument is provably without `count`: absent,
// or an object literal with no spread, no computed name, and no `count`.
function mayCarryCount(optionsArgument) {
  if (optionsArgument === undefined) return false;

  if (!typescript.isObjectLiteralExpression(optionsArgument)) return true;

  return optionsArgument.properties.some((property) => {
    if (typescript.isSpreadAssignment(property)) return true;

    const name = propertyNameText(property.name);

    return name === null || name === 'count';
  });
}

// Every plural-key call without `count` in `source`, in file order.
function findViolations(filePath, source, pluralKeys) {
  const sourceFile = parse(filePath, source);
  const violations = [];

  const visit = (node) => {
    if (
      typescript.isCallExpression(node) &&
      isTranslateCallee(node.expression) &&
      node.arguments.length > 0 &&
      typescript.isStringLiteral(node.arguments[0]) &&
      pluralKeys.has(node.arguments[0].text) &&
      !mayCarryCount(node.arguments[1])
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({ line: line + 1, key: node.arguments[0].text });
    }

    typescript.forEachChild(node, visit);
  };

  visit(sourceFile);

  return violations;
}

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: plural-count.js <file...>\n');
    process.exit(2);
  }

  const pluralKeys = readPluralKeys(CATALOGUE_PATH);
  let anyViolation = false;

  for (const file of files) {
    if (CATALOGUE_FILE.test(file.split(path.sep).join('/'))) continue;

    const violations = findViolations(file, fs.readFileSync(file, 'utf8'), pluralKeys);

    for (const violation of violations) {
      anyViolation = true;
      process.stdout.write(`${file}:${violation.line}: t('${violation.key}') has no count\n`);
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations, readPluralKeys };
