#!/usr/bin/env node

// Prints, one per line, the changed source files that differ from the base ONLY in
// comments or whitespace, so scripts/checks/mutation.sh leaves them out of a mutation run
// (a comment-only edit of one screen once cost a 178-minute run).
//
//   usage: comment-only-changes.js <merge-base> <path>...
//
// The gate diffs <merge-base>..HEAD, so both sides are read from git
// (`git show <merge-base>:<path>` and `git show HEAD:<path>`), never from the working tree.
//
// A path is printed only when this script PROVED it comment/whitespace-only. Every doubt keeps
// the file (it is not printed, so it is mutated): a file that is not .ts/.tsx, absent at the
// base (new or renamed) or at HEAD, unchanged in content, one that does not parse on either
// side, a `git show` that fails, typescript that cannot be loaded, any exception, and any
// misuse. Nothing here can make a file leave the mutation run by accident.
//
// HOW TWO FILES ARE COMPARED. The TypeScript parser drops comments and whitespace as trivia, so
// the comparison walks each parse tree (getChildren, which also yields the punctuation and
// keyword tokens) and records, per node, its kind and nesting, and per leaf its kind and exact
// source text. Two files are equal when those walks are equal. This is exact where the cheaper
// alternatives are not:
//   - a token-only walk, or a regex, would call `return\n  x` and `return x` equal (the line
//     break ends the `return`: ASI), and would read a space inside a string, template, regular
//     expression or JSX text as whitespace; the tree walk keeps the structure, and a literal
//     leaf keeps its own text, so a respelled number (1000 vs 1e3), a changed quote, or a space
//     inside any literal differs;
//   - ts.createPrinter would decide from reprinted text, a black box that also bakes in layout
//     flags (a multi-line object literal), so it could not tell formatting from a change.
// A JsxText leaf is read from its full pos..end span: getText() would skip its leading
// whitespace, which JSX keeps. JSDoc nodes are skipped; they are comments.
//
// COMMENTS THAT CHANGE MUTATION OR COMPILATION keep the file even when only comments changed:
//   - `Stryker` (a Stryker `disable` or `restore` directive changes the mutant set, and its
//     reach depends on the lines around it, so any edit of a file that holds one is mutated);
//   - a JSX pragma (`@jsx`, `@jsxImportSource`, `@jsxRuntime`, `@jsxFrag`: they change how the
//     file compiles).
// Both sides are searched whole, not just the diff lines, so moving or separating a directive
// from its target counts too. A `@ts-` directive changes type errors only, never runtime or the
// mutant set (stryker.conf.json has no typescript checker), so it needs no entry. A `/* istanbul
// ignore */` or `/*#__PURE__*/` comment changes coverage or minification only, not what Stryker
// mutates.
//
// mutation.sh passes only the changed source files, so a printed path mutates nothing whatever
// the test beside it did (user ruling 2026-10-14).
//
// Unlike every other checker in this directory it requires an npm package (typescript). That is
// safe because it runs only inside mutation.sh, in a full worktree where Stryker itself needs
// node_modules, never in the pre-write guard or in the guard-replay scratch checkout (which has
// no node_modules); see docs/harness/documented-exceptions.md.

const path = require('node:path');
const childProcess = require('node:child_process');

const SEMANTIC_COMMENT_PATTERN = /Stryker|@jsx/;
const SOURCE_EXTENSIONS = new Map([
  ['.ts', 'TS'],
  ['.tsx', 'TSX'],
]);
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const loadTypescript = () => {
  try {
    return require('typescript');
  } catch {
    return null;
  }
};

const readAt = (revision, filePath) =>
  childProcess.execFileSync('git', ['show', `${revision}:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: MAX_FILE_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

// A parse tree reduced to what changes behavior: nested [kind, ...children] arrays with a
// [kind, text] pair at each leaf. Returns null for a file that does not parse cleanly.
const structureOf = (typescript, filePath, text, scriptKindName) => {
  const sourceFile = typescript.createSourceFile(
    filePath,
    text,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind[scriptKindName],
  );

  if (sourceFile.parseDiagnostics.length > 0) return null;

  const leafText = (node) =>
    node.kind === typescript.SyntaxKind.JsxText
      ? text.slice(node.pos, node.end)
      : text.slice(node.getStart(sourceFile), node.end);

  const walk = (node) => {
    const children = node
      .getChildren(sourceFile)
      .filter((child) => child.kind !== typescript.SyntaxKind.JSDoc);

    return children.length === 0 ? [node.kind, leafText(node)] : [node.kind, ...children.map(walk)];
  };

  return JSON.stringify(walk(sourceFile));
};

const isCommentOnlyChange = (typescript, revision, filePath) => {
  try {
    const scriptKindName = SOURCE_EXTENSIONS.get(path.extname(filePath));

    if (scriptKindName === undefined) return false;

    const baseText = readAt(revision, filePath);
    const headText = readAt('HEAD', filePath);

    if (baseText === headText) return false;
    if (SEMANTIC_COMMENT_PATTERN.test(baseText) || SEMANTIC_COMMENT_PATTERN.test(headText)) {
      return false;
    }

    const baseStructure = structureOf(typescript, filePath, baseText, scriptKindName);
    const headStructure = structureOf(typescript, filePath, headText, scriptKindName);

    return baseStructure !== null && baseStructure === headStructure;
  } catch {
    return false;
  }
};

const [revision, ...filePaths] = process.argv.slice(2);

if (!revision) {
  process.stderr.write('usage: comment-only-changes.js <merge-base> <path>...\n');
  process.exit(2);
}

const typescript = loadTypescript();

if (typescript !== null) {
  const skipped = filePaths.filter((filePath) =>
    isCommentOnlyChange(typescript, revision, filePath),
  );

  if (skipped.length > 0) process.stdout.write(`${skipped.join('\n')}\n`);
}
