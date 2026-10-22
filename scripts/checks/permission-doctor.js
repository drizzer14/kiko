#!/usr/bin/env node

// Reports permission path rules that cannot do what they say, so a user stops adding allow rules
// that never pre-approve anything. It only reads: it prints the suggested JSON and writes no
// settings file, because an agent must not edit its own permission settings.
//
// Usage: permission-doctor.js   (run from anywhere; the cwd decides which repository is read)
//
// Settings files read (a missing file is no finding, an unreadable one is):
//   - $CLAUDE_CONFIG_DIR/settings.json when CLAUDE_CONFIG_DIR is set, and
//     $HOME/.claude/settings.json
//   - when the cwd is inside a git repository: that repository's and its main checkout's
//     .claude/settings.json and .claude/settings.local.json
//
// Findings, each rests on the Claude Code permission docs (code.claude.com/docs/en/permissions
// and /permission-modes):
//   protected path  An allow rule for Edit, Write or NotebookEdit whose path lands under a
//                   protected directory (.git, .claude, .husky, ...) or is a protected file
//                   (.npmrc, ...). Writes there are never auto-approved, so the rule can never
//                   pre-approve one. "Allow rules apply only when both the requested path and
//                   the file it resolves to match": the literal prefix of the rule (the part
//                   before its first glob segment) is checked as written and after resolving
//                   symlinks (the deepest existing parent, then the rest appended); a glob is
//                   never expanded against the folder listing, because a glob can match more
//                   than the folders that exist. The documented exceptions pass:
//                   <home>/.claude/plans/ (the session's plan files),
//                   <home>/.claude/jobs/<id>/tmp/, .claude/worktrees/, and, in a session started
//                   without --restricted, Markdown files in
//                   <home>/.claude/projects/<project>/memory/ (the memory folder directly under
//                   the project folder) or .claude/agent-memory/. The plans, jobs and projects
//                   exceptions are anchored to <home>/.claude, a copy of those folder names
//                   elsewhere is protected.
//   partly protected path
//                   A rule of that kind whose glob can still match an exception and also paths
//                   that are never pre-approved (".claude/projects/**/memory/**"). It is not
//                   removed: the suggestion replaces it with the Markdown form
//                   (".../memory/**/*.md") when that form is fully excepted, and otherwise asks
//                   for a hand narrowing. A rule that can name an exception folder or one of its
//                   ancestors covers that folder's files, so it counts as the folder.
//   path form       In a user settings file a Read, Edit, Write or NotebookEdit rule with one
//                   leading slash whose literal folder exists at the filesystem root. "/path" is
//                   relative to the settings source and "//path" is the absolute path, so the
//                   rule was almost certainly meant as "//path".
//   drift           A rule that only one of $CLAUDE_CONFIG_DIR/settings.json and
//                   $HOME/.claude/settings.json holds, in the allow, ask or deny list.
//
// Known limits: Bash rules are not judged. A relative rule ("/x", "./x", "x") in a user settings
// file has no known base and is skipped for the protected-path finding. A rule with no literal
// leading folder ("**/.claude/**") is skipped, and only the literal prefix is judged for a
// protected folder ("~/repo/*/.git/**" is not). A subfolder rule under a Markdown exception
// ("projects/<p>/memory/sub", "memory/?") is reported remove, although it can cover .md files. A
// project settings file's relative rule is read against that project's root, which is the
// documented base only for "/x". Managed settings, additionalDirectories, --plugin-dir and
// plansDirectory are not read.
//
// Exit 0: clean. Exit 1: findings or unreadable files, printed on stdout. Exit 3: the checker
// crashed, with the error on stderr. The checker is dependency-free (node:* only), like the other
// checkers.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PATH_TOOLS = ['Read', 'Edit', 'Write', 'NotebookEdit'];
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const RULE_LISTS = ['allow', 'ask', 'deny'];
const PROTECTED_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.husky',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
  '.claude',
];
const PROTECTED_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.profile',
  '.npmrc',
  '.yarnrc',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  '.mcp.json',
  '.claude.json',
];
const RULE_PATTERN = /^([A-Za-z]+)\(([\s\S]*)\)$/;
const GLOB_PATTERN = /[*?[]/;
const VARIABLE_LENGTH_PATTERN = /[*[]/;
const RECURSIVE_SEGMENT = '**';
const MARKDOWN_PATTERN = /\.md$/i;
const ANY_FOLDER = '*';
// The documented exceptions under a .claude folder, as the folder names that lead to the excepted
// files. Plans, jobs and projects are the ones under <home>/.claude, so they only count there.
const EXCEPTION_FOLDERS = [
  { anchored: false, prefix: ['worktrees'], markdown: false },
  { anchored: true, prefix: ['plans'], markdown: false },
  { anchored: true, prefix: ['jobs', ANY_FOLDER, 'tmp'], markdown: false },
  { anchored: false, prefix: ['agent-memory'], markdown: true },
  { anchored: true, prefix: ['projects', ANY_FOLDER, 'memory'], markdown: true },
];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitSegments(text) {
  const segments = [];

  for (const segment of text.split('/')) {
    if (segment === '..') {
      segments.pop();
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment);
    }
  }

  return segments;
}

function joinSegments(segments) {
  return `/${segments.join('/')}`;
}

function runGit(gitArguments) {
  const result = spawnSync('git', gitArguments, { encoding: 'utf8' });

  return result.error === undefined && result.status === 0 ? result.stdout : '';
}

function homeDirectory() {
  return process.env.HOME || os.homedir();
}

function realPathOrNothing(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return undefined;
  }
}

function resolveDeepest(absolute) {
  const real = realPathOrNothing(absolute);

  if (real !== undefined) {
    return real;
  }

  const parent = path.dirname(absolute);

  return parent === absolute
    ? absolute
    : path.join(resolveDeepest(parent), path.basename(absolute));
}

function readSettings(file, source, root) {
  let text;

  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR'
      ? undefined
      : { file, source, root, problem: error.message };
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { file, source, root, problem: `not valid JSON (${error.message})` };
  }

  const permissions = isRecord(parsed) ? parsed.permissions : undefined;
  const rules = {};

  for (const list of RULE_LISTS) {
    const value = isRecord(permissions) ? permissions[list] : undefined;

    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((rule) => typeof rule !== 'string'))
    ) {
      return { file, source, root, problem: `permissions.${list} is not an array of strings` };
    }

    rules[list] = value ?? [];
  }

  return { file, source, root, rules };
}

function repositoryRoots() {
  const top = runGit(['rev-parse', '--show-toplevel']).trim();

  if (top === '') {
    return [];
  }

  const main = runGit(['worktree', 'list', '--porcelain'])
    .split('\n')
    .find((line) => line.startsWith('worktree '));

  return [...new Set([top, ...(main === undefined ? [] : [main.slice('worktree '.length)])])];
}

function settingsFiles() {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR;
  const userFiles = [
    ...(configDirectory ? [path.join(configDirectory, 'settings.json')] : []),
    path.join(homeDirectory(), '.claude', 'settings.json'),
  ];
  const projectFiles = repositoryRoots().flatMap((root) =>
    ['settings.json', 'settings.local.json'].map((name) => ({
      file: path.join(root, '.claude', name),
      root,
    })),
  );
  const seen = new Set();

  return [
    ...userFiles.map((file) => ({ file, source: 'user', root: undefined })),
    ...projectFiles.map((entry) => ({ ...entry, source: 'project' })),
  ].filter(({ file }) => {
    const identity = realPathOrNothing(file) ?? file;

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);

    return true;
  });
}

function parseRule(rule) {
  const match = RULE_PATTERN.exec(rule);

  return match === null ? undefined : { tool: match[1], pattern: match[2] };
}

function absolutePattern(pattern, root) {
  if (pattern.startsWith('!')) {
    return undefined;
  }

  if (pattern.startsWith('//')) {
    return splitSegments(pattern.slice(1));
  }

  if (pattern === '~' || pattern.startsWith('~/')) {
    return splitSegments(`${homeDirectory()}/${pattern.slice(1)}`);
  }

  return root === undefined ? undefined : splitSegments(`${root}/${pattern}`);
}

function splitLiteralPrefix(segments) {
  const globIndex = segments.findIndex((segment) => GLOB_PATTERN.test(segment));
  const literalCount = globIndex === -1 ? segments.length : globIndex;

  return { literal: segments.slice(0, literalCount), rest: segments.slice(literalCount) };
}

function sameSegments(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

// A glob segment is read as one name: "*" is any run of characters, "?" one character, and a
// "[..]" class ("[!..]" or "[^..]" negated) one character of the set. A class that does not parse
// matches any name, the safe error: the rule is then reported as partly protected, never removed.
const GLOB_TOKEN = /\[[!^]?[^\]]+\]|[\s\S]/g;

function segmentExpression(segment) {
  const source = segment.replace(GLOB_TOKEN, (token) => {
    if (token === '*') {
      return '.*';
    }

    if (token === '?') {
      return '.';
    }

    if (token.length === 1) {
      return token.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    const negated = /^\[[!^]/.test(token);

    return `[${negated ? '^' : ''}${token.slice(negated ? 2 : 1, -1).replace(/\\/g, '\\\\')}]`;
  });

  try {
    return new RegExp(`^${source}$`);
  } catch {
    return /^/;
  }
}

function segmentCanBe(segment, name) {
  return segmentExpression(segment).test(name);
}

// A bracket class gives no fixed tail, so only the characters before it are compared.
function globTail(segment) {
  return segment.includes('[') ? '' : segment.slice(segment.search(/[^*?]*$/));
}

// A "?" is exactly one character, so a segment without "*" or "[" can end in ".md" only when its
// last three characters fit those.
function fixedLengthCanBeMarkdown(segment) {
  const ending = segment.slice(-3).toLowerCase();

  return (
    ending.length === 3 &&
    [...ending].every((character, index) => character === '?' || character === '.md'[index])
  );
}

function canBeMarkdown(segment) {
  if (!GLOB_PATTERN.test(segment)) {
    return MARKDOWN_PATTERN.test(segment);
  }

  return VARIABLE_LENGTH_PATTERN.test(segment)
    ? '.md'.endsWith(globTail(segment).toLowerCase()) || MARKDOWN_PATTERN.test(globTail(segment))
    : fixedLengthCanBeMarkdown(segment);
}

function prefixFits(after, prefix, strict) {
  return prefix.every((name, index) => {
    const segment = after[index];

    if (segment === undefined) {
      return false;
    }

    if (name === ANY_FOLDER) {
      return !strict || segment !== RECURSIVE_SEGMENT;
    }

    return strict ? segment === name : segmentCanBe(segment, name);
  });
}

function matchesExceptionFolder(after, folder, strict) {
  // A "**" in any slot can span the folders in between, so the slots behind it are unknown.
  const hiddenAt = strict ? -1 : after.slice(0, folder.prefix.length).indexOf(RECURSIVE_SEGMENT);

  if (hiddenAt !== -1) {
    return prefixFits(after, folder.prefix.slice(0, hiddenAt), false);
  }

  if (!prefixFits(after, strict ? folder.prefix : folder.prefix.slice(0, after.length), strict)) {
    return false;
  }

  const last = after[after.length - 1];

  if (strict) {
    return !folder.markdown || (after.length > folder.prefix.length && MARKDOWN_PATTERN.test(last));
  }

  return after.length <= folder.prefix.length || !folder.markdown || canBeMarkdown(last);
}

function folderVerdict(after, folder) {
  if (matchesExceptionFolder(after, folder, true)) {
    return 'exempt';
  }

  return matchesExceptionFolder(after, folder, false) ? 'partial' : 'none';
}

// 'exempt': every file the rule names is an exception. 'partial': the rule can reach an
// exception and other files, as a folder rule that can be an exception folder or one of its
// ancestors covers that folder's files. 'none': no exception can match.
function exceptionVerdict(after, anchored) {
  const verdicts = EXCEPTION_FOLDERS.filter((folder) => anchored || !folder.anchored).map(
    (folder) => folderVerdict(after, folder),
  );

  if (verdicts.includes('partial')) {
    return 'partial';
  }

  return verdicts.includes('exempt') ? 'exempt' : 'none';
}

function directoryVerdict(segments, index, context) {
  if (segments[index] !== '.claude') {
    return 'none';
  }

  const anchored = context.anchors.some((anchor) => sameSegments(anchor, segments.slice(0, index)));

  return exceptionVerdict(segments.slice(index + 1), anchored);
}

function protectedFileName(segments, literalCount, configSegments) {
  const last = segments[segments.length - 1];

  if (literalCount === segments.length && PROTECTED_FILES.includes(last)) {
    return last;
  }

  const literal = segments.slice(0, literalCount);
  const developmentModifications = [...configSegments, 'dev-mods'];

  return configSegments.length > 0 &&
    developmentModifications.every((name, index) => literal[index] === name)
    ? 'dev-mods'
    : undefined;
}

function protectedName(segments, literalCount, context) {
  let partial;

  for (let index = 0; index < literalCount; index += 1) {
    const name = segments[index];

    if (name === '.config' && index + 1 < literalCount && segments[index + 1] === 'git') {
      return { name: '.config/git', partial: false };
    }

    if (PROTECTED_DIRECTORIES.includes(name)) {
      const verdict = directoryVerdict(segments, index, context);

      if (verdict === 'none') {
        return { name, partial: false };
      }

      partial = verdict === 'partial' ? (partial ?? { name, partial: true }) : partial;
    }
  }

  const fileName = protectedFileName(segments, literalCount, context.configSegments);

  return fileName === undefined ? partial : { name: fileName, partial: false };
}

// A hard finding (no exception can match) wins over a partial one, whichever spelling it is in.
function protectedPathReason(pattern, root, context) {
  const segments = absolutePattern(pattern, root);

  if (segments === undefined) {
    return undefined;
  }

  const { literal, rest } = splitLiteralPrefix(segments);
  const resolved = splitSegments(resolveDeepest(joinSegments(literal)));
  const variants = [
    { label: 'as written', literal },
    { label: 'after symlinks', literal: resolved },
  ];
  let partial;

  for (const variant of variants) {
    const full = [...variant.literal, ...rest];
    const found = protectedName(full, variant.literal.length, context);

    if (found !== undefined) {
      const reason = {
        partial: found.partial,
        text: `${variant.label}, ${joinSegments(full)} ${found.partial ? 'can land' : 'lands'} under protected ${found.name}`,
      };

      if (!found.partial) {
        return reason;
      }

      partial = partial ?? reason;
    }
  }

  return partial;
}

// The project slot of the memory exception is one folder, so a "**" there narrows to "*". A rule
// already ending in ".md" is a Markdown form, so only that slot changes.
function narrowToMarkdown(pattern) {
  const oneProject = pattern.replace(/\/projects\/\*\*\/memory(?=\/|$)/, '/projects/*/memory');

  if (MARKDOWN_PATTERN.test(oneProject)) {
    return oneProject;
  }

  return oneProject.endsWith('/**') ? `${oneProject}/*.md` : `${oneProject}.md`;
}

const EXCEPTION_LIST =
  "the session's plan files in ~/.claude/plans/ (or plansDirectory), ~/.claude/jobs/<id>/tmp/, .claude/worktrees/, and, in a session started without --restricted, Markdown files in ~/.claude/projects/<project>/memory/ or .claude/agent-memory/";

function protectedPathFinding(settings, parsed, rule, reason, context) {
  const base = { file: settings.file, rule };

  if (!reason.partial) {
    return {
      ...base,
      kind: 'protected path',
      detail: `${reason.text}; writes there are never auto-approved, so this allow rule can never pre-approve one. The exceptions are ${EXCEPTION_LIST}, and none of them can match this rule.`,
      suggestion: { file: settings.file, list: 'allow', remove: rule },
    };
  }

  const segments = splitSegments(parsed.pattern);
  const narrowed = narrowToMarkdown(parsed.pattern);
  // A rule that ends at the .claude folder has no name to put ".md" on.
  const narrowsCleanly =
    segments[segments.length - 1] !== '.claude' &&
    protectedPathReason(narrowed, settings.root, context) === undefined;

  return {
    ...base,
    kind: 'partly protected path',
    detail: `${reason.text}; this rule also matches a file that is never auto-approved, so it pre-approves only the part inside an exception. The exceptions are ${EXCEPTION_LIST}.`,
    suggestion: narrowsCleanly
      ? { file: settings.file, list: 'allow', replace: rule, with: `${parsed.tool}(${narrowed})` }
      : {
          file: settings.file,
          list: 'allow',
          fix: 'narrow the rule by hand to the exception folders; no single replacement fits it',
        },
  };
}

function protectedPathFindings(settings, context) {
  return settings.rules.allow.flatMap((rule) => {
    const parsed = parseRule(rule);

    if (parsed === undefined || !WRITE_TOOLS.includes(parsed.tool)) {
      return [];
    }

    const reason = protectedPathReason(parsed.pattern, settings.root, context);

    return reason === undefined
      ? []
      : [protectedPathFinding(settings, parsed, rule, reason, context)];
  });
}

function pathFormFindings(settings) {
  return RULE_LISTS.flatMap((list) =>
    settings.rules[list].flatMap((rule) => {
      const parsed = parseRule(rule);

      if (
        parsed === undefined ||
        !PATH_TOOLS.includes(parsed.tool) ||
        !parsed.pattern.startsWith('/') ||
        parsed.pattern.startsWith('//')
      ) {
        return [];
      }

      const segments = splitSegments(parsed.pattern);
      const literalCount = segments.findIndex((segment) => GLOB_PATTERN.test(segment));
      const literal = literalCount === -1 ? segments : segments.slice(0, literalCount);

      if (literal.length === 0 || !fs.existsSync(joinSegments(literal))) {
        return [];
      }

      const rewrite = `${parsed.tool}(/${parsed.pattern})`;

      return [
        {
          kind: 'path form',
          file: settings.file,
          rule,
          detail: `"/path" is relative to the settings source and "//path" is the absolute path, and ${joinSegments(literal)} exists at the filesystem root; this rule was probably meant as ${rewrite}.`,
          suggestion: { file: settings.file, list, replace: rule, with: rewrite },
        },
      ];
    }),
  );
}

function driftFindings(left, right) {
  const oneSided = (holder, other) =>
    RULE_LISTS.flatMap((list) =>
      holder.rules[list]
        .filter((rule) => !other.rules[list].includes(rule))
        .map((rule) => ({
          kind: 'drift',
          file: holder.file,
          rule,
          detail: `the ${list} rule is in ${holder.file} and not in ${other.file}; Claude Code reads one of the two user settings files, so the other copy is stale or the rule is lost.`,
          suggestion: { file: other.file, list, add: rule },
        })),
    );

  return [...oneSided(left, right), ...oneSided(right, left)];
}

function formatFinding(finding) {
  return [
    `[${finding.kind}] ${finding.file}`,
    `  rule:    ${finding.rule}`,
    `  why:     ${finding.detail}`,
    `  suggest: ${JSON.stringify(finding.suggestion)}`,
  ].join('\n');
}

function main() {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR;
  const configSegments = configDirectory
    ? splitSegments(resolveDeepest(path.resolve(configDirectory)))
    : [];
  const linkedClaude = splitSegments(resolveDeepest(path.join(homeDirectory(), '.claude')));
  const context = {
    configSegments,
    anchors: [
      splitSegments(homeDirectory()),
      splitSegments(resolveDeepest(homeDirectory())),
      ...[configSegments, linkedClaude]
        .filter((segments) => segments[segments.length - 1] === '.claude')
        .map((segments) => segments.slice(0, -1)),
    ],
  };
  const loaded = settingsFiles().flatMap(({ file, source, root }) => {
    const settings = readSettings(file, source, root);

    return settings === undefined ? [] : [settings];
  });
  const readable = loaded.filter((settings) => settings.problem === undefined);
  const userSettings = readable.filter((settings) => settings.source === 'user');
  const findings = [
    ...loaded
      .filter((settings) => settings.problem !== undefined)
      .map((settings) => ({
        kind: 'unreadable settings file',
        file: settings.file,
        rule: '-',
        detail: `${settings.problem}; a file that cannot be read cannot be checked, so it is reported instead of read as clean.`,
        suggestion: { file: settings.file, fix: 'repair the file by hand' },
      })),
    ...readable.flatMap((settings) => protectedPathFindings(settings, context)),
    ...userSettings.flatMap(pathFormFindings),
    ...(userSettings.length === 2 && loaded.every((settings) => settings.problem === undefined)
      ? driftFindings(userSettings[0], userSettings[1])
      : []),
  ];

  if (findings.length === 0) {
    return 0;
  }

  process.stdout.write(`${findings.map(formatFinding).join('\n')}\n`);

  return 1;
}

function run() {
  try {
    return main();
  } catch (error) {
    process.stderr.write(`permission doctor could not run: ${error.message}\n`);

    return 3;
  }
}

process.exitCode = run();
