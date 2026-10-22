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
//                   the file it resolves to match": the path is checked as written and after
//                   resolving symlinks (the deepest existing parent, then the rest appended),
//                   and a glob segment is expanded against the folder listing. The documented
//                   exceptions pass: .claude/worktrees/, .claude/plans/, .claude/jobs/<id>/tmp/,
//                   and Markdown files in .claude/projects/<project>/memory/ or
//                   .claude/agent-memory/.
//   path form       In a user settings file a Read, Edit, Write or NotebookEdit rule with one
//                   leading slash whose literal folder exists at the filesystem root. "/path" is
//                   relative to the settings source and "//path" is the absolute path, so the
//                   rule was almost certainly meant as "//path".
//   drift           A rule that only one of $CLAUDE_CONFIG_DIR/settings.json and
//                   $HOME/.claude/settings.json holds, in the allow, ask or deny list.
//
// Known limits: Bash rules are not judged. A relative rule ("/x", "./x", "x") in a user settings
// file has no known base and is skipped for the protected-path finding. A rule with no literal
// leading folder ("**/.claude/**") is skipped. A project settings file's relative rule is read
// against that project's root, which is the documented base only for "/x". Managed settings,
// additionalDirectories and --plugin-dir are not read.
//
// Exit 0: clean. Exit 1: findings or unreadable files, printed on stdout. The checker is
// dependency-free (node:* only), like the other checkers.

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
const MARKDOWN_PATTERN = /\.md$/i;
const EXPANSION_LIMIT = 200;

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

function globExpression(segment) {
  const source = segment
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');

  return new RegExp(`^${source}$`);
}

function listDirectory(directory) {
  try {
    return fs.readdirSync(directory);
  } catch {
    return [];
  }
}

function expand(literal, segments, budget) {
  const literalCount = segments.findIndex((segment) => GLOB_PATTERN.test(segment));

  if (literalCount === -1) {
    return [{ literal: [...literal, ...segments], rest: [] }];
  }

  const base = [...literal, ...segments.slice(0, literalCount)];
  const rest = segments.slice(literalCount);

  if (rest[0].includes('**') || budget.remaining <= 0) {
    return [{ literal: base, rest }];
  }

  const expression = globExpression(rest[0]);
  const matches = listDirectory(joinSegments(base)).filter((entry) => expression.test(entry));

  if (matches.length === 0) {
    return [{ literal: base, rest }];
  }

  return matches.flatMap((entry) => {
    budget.remaining -= 1;

    return expand([...base, entry], rest.slice(1), budget);
  });
}

function isMarkdownTarget(segments) {
  return MARKDOWN_PATTERN.test(segments[segments.length - 1] ?? '');
}

function isExemptClaudeDirectory(after) {
  const [first, , third] = after;

  if (first === 'worktrees' || first === 'plans') {
    return true;
  }

  if (first === 'jobs') {
    return third === 'tmp';
  }

  if (first === 'agent-memory') {
    return after.length > 1 && isMarkdownTarget(after);
  }

  if (first === 'projects') {
    const memoryIndex = after.indexOf('memory', 2);

    return memoryIndex !== -1 && memoryIndex < after.length - 1 && isMarkdownTarget(after);
  }

  return false;
}

function protectedName(segments, literalCount, configSegments) {
  const literal = segments.slice(0, literalCount);

  for (let index = 0; index < literal.length; index += 1) {
    const name = literal[index];

    if (name === '.config' && literal[index + 1] === 'git') {
      return '.config/git';
    }

    if (PROTECTED_DIRECTORIES.includes(name)) {
      if (name !== '.claude' || !isExemptClaudeDirectory(segments.slice(index + 1))) {
        return name;
      }
    }
  }

  const last = segments[segments.length - 1];

  if (literalCount === segments.length && PROTECTED_FILES.includes(last)) {
    return last;
  }

  const developmentModifications = [...configSegments, 'dev-mods'];

  if (
    configSegments.length > 0 &&
    developmentModifications.every((name, index) => literal[index] === name)
  ) {
    return 'dev-mods';
  }

  return undefined;
}

function protectedPathReason(pattern, root, configSegments) {
  const segments = absolutePattern(pattern, root);

  if (segments === undefined) {
    return undefined;
  }

  const budget = { remaining: EXPANSION_LIMIT };

  for (const { literal, rest } of expand([], segments, budget)) {
    const resolved = splitSegments(resolveDeepest(joinSegments(literal)));
    const variants = [
      { label: 'as written', literal, rest },
      { label: 'after symlinks', literal: resolved, rest },
    ];

    for (const variant of variants) {
      const name = protectedName(
        [...variant.literal, ...variant.rest],
        variant.literal.length,
        configSegments,
      );

      if (name !== undefined) {
        return `${variant.label}, ${joinSegments([...variant.literal, ...variant.rest])} lands under protected ${name}`;
      }
    }
  }

  return undefined;
}

function protectedPathFindings(settings, configSegments) {
  return settings.rules.allow.flatMap((rule) => {
    const parsed = parseRule(rule);

    if (parsed === undefined || !WRITE_TOOLS.includes(parsed.tool)) {
      return [];
    }

    const reason = protectedPathReason(parsed.pattern, settings.root, configSegments);

    return reason === undefined
      ? []
      : [
          {
            kind: 'protected path',
            file: settings.file,
            rule,
            detail: `${reason}; writes there are never auto-approved, so this allow rule can never pre-approve one. The exceptions are .claude/worktrees/, .claude/plans/, .claude/jobs/<id>/tmp/ and Markdown files in .claude/projects/<project>/memory/ or .claude/agent-memory/.`,
            suggestion: { file: settings.file, list: 'allow', remove: rule },
          },
        ];
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
    ...readable.flatMap((settings) => protectedPathFindings(settings, configSegments)),
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

process.exitCode = main();
