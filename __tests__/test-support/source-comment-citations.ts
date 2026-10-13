import ts from 'typescript';

import { lineCountBefore } from './markdown-code-spans';

// The repo paths and migration file names that the comments of one source file name, for
// cited-paths.test.ts. Comments come from the TypeScript parse, so a path inside a string, a
// template or JSX text is never read as one.
export type Citation = { line: number; path: string };

export type SourceComment = { line: number; text: string };

const TREE_PATH_PATTERN =
  /(?<![\w./~$-])(?:src|docs|rules|e2e|harness|drizzle|scripts|__tests__|\.claude)\/[\w./-]+\.\w+/g;

const MIGRATION_NAME_PATTERN = /(?<![\w-])\d{4}_[a-z0-9_]+\.sql(?!\w)/g;

// The parse reads a comment on the line of the token before it as a trailing comment and any other
// as a leading one of the next token, so both are collected from every node and token. JSX text
// holds no comment, and a list of children starts where its first child does, so JSX text and a
// list never collect: a list that opens with JSX text would read `// x` there as a comment.
const commentRanges = (sourceFile: ts.SourceFile): ts.CommentRange[] => {
  const ranges = new Map<number, ts.CommentRange>();

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      return;
    }

    if (node.kind !== ts.SyntaxKind.SyntaxList) {
      const start = node.getFullStart();

      for (const range of [
        ...(ts.getLeadingCommentRanges(sourceFile.text, start) ?? []),
        ...(ts.getTrailingCommentRanges(sourceFile.text, start) ?? []),
      ]) {
        ranges.set(range.pos, range);
      }
    }

    node.getChildren(sourceFile).forEach(visit);
  };

  visit(sourceFile);

  return [...ranges.values()].sort((first, second) => first.pos - second.pos);
};

const citationsInComment = (comment: SourceComment): Citation[] => {
  const treePaths = [...comment.text.matchAll(TREE_PATH_PATTERN)];

  // A migration path already names its file, so its bare name is not reported a second time.
  const bareNames = [...comment.text.matchAll(MIGRATION_NAME_PATTERN)].filter(
    (name) =>
      !treePaths.some(
        (treePath) =>
          (name.index ?? 0) >= (treePath.index ?? 0) &&
          (name.index ?? 0) < (treePath.index ?? 0) + treePath[0].length,
      ),
  );

  return [...treePaths, ...bareNames]
    .map((match) => ({ offset: match.index ?? 0, path: match[0] }))
    .sort((first, second) => first.offset - second.offset)
    .map(({ offset, path }) => ({
      line: comment.line + lineCountBefore(comment.text, offset),
      path,
    }));
};

export const sourceComments = (fileName: string, text: string): SourceComment[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return commentRanges(sourceFile).map((range) => ({
    line: sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1,
    text: sourceFile.text.slice(range.pos, range.end),
  }));
};

export const sourceCommentCitations = (fileName: string, text: string): Citation[] =>
  sourceComments(fileName, text).flatMap(citationsInComment);
