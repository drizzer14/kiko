import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { readTextFile } from './test-support/read-text-file';
import { writeExecutable } from './test-support/mutation-repository';

// scripts/checks/permission-doctor.sh reads the user's permission settings and reports an allow
// rule that can never pre-approve a write, plus drift between the two user settings files. It
// runs here against a temporary HOME and a temporary CLAUDE_CONFIG_DIR whose `projects` entry is
// a real symlink into `<home>/.claude/projects`, the layout of an Orca profile. The cwd is a
// folder that is no repository, so only the two user settings files are read. Each finding kind
// cites the permission docs it rests on, in the comment at the top of its row.
const SCRIPT = join(__dirname, '../scripts/checks/permission-doctor.sh');
const CHECKER = join(__dirname, '../scripts/checks/permission-doctor.js');
const FIXED_MODIFICATION_SECONDS = 1_000_000_000;
const PROJECT = '-Users-example-project';

type Layout = {
  home: string;
  profile: string;
  working: string;
  homeSettings: string;
  profileSettings: string;
};

let layout: Layout;

beforeEach(() => {
  const home = realpathSync(createTemporaryDirectory('permission-doctor-home-'));
  const profile = join(
    realpathSync(createTemporaryDirectory('permission-doctor-profile-')),
    'home',
  );
  const working = realpathSync(createTemporaryDirectory('permission-doctor-working-'));
  mkdirSync(join(home, '.claude/projects', PROJECT, 'memory'), { recursive: true });
  mkdirSync(join(home, 'shared'), { recursive: true });
  mkdirSync(profile, { recursive: true });
  symlinkSync(join(home, '.claude/projects'), join(profile, 'projects'));
  symlinkSync(join(home, 'shared'), join(profile, 'shared'));
  layout = {
    home,
    profile,
    working,
    homeSettings: join(home, '.claude/settings.json'),
    profileSettings: join(profile, 'settings.json'),
  };
});

afterEach(removeTemporaryDirectories);

const settingsOf = (allow: string[]): string =>
  `${JSON.stringify({ permissions: { allow } }, null, 2)}\n`;

// Both user settings files carry the same rules unless a row says otherwise, so a row that is
// not about drift never trips the drift finding.
const writeSettings = (allow: string[], profileAllow: string[] = allow): void => {
  writeFileSync(layout.homeSettings, settingsOf(allow));
  writeFileSync(layout.profileSettings, settingsOf(profileAllow));
};

const runDoctor = (withProfile = true): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    cwd: layout.working,
    env: {
      PATH: process.env.PATH,
      HOME: layout.home,
      ...(withProfile ? { CLAUDE_CONFIG_DIR: layout.profile } : {}),
    },
  });

const blockOf = (result: SpawnSyncReturns<string>): string => result.stderr;

describe('scripts/checks/permission-doctor.sh: protected paths', () => {
  it('flags an allow rule for a write under ~/.claude (writes there are never auto-approved)', () => {
    // Permission docs, protected paths: "Writes to a small set of paths are never
    // auto-approved".
    const rule = 'Edit(~/.claude/agents/helper.md)';
    writeSettings([rule, 'Write(~/.claude/hooks/run.sh)']);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('CHECK FAILED');
    expect(blockOf(result)).toContain('protected path');
    expect(blockOf(result)).toContain(rule);
    expect(blockOf(result)).toContain('Write(~/.claude/hooks/run.sh)');
    expect(result.stdout).toBe('');
  });

  it('flags a rule spelled through the profile that resolves into a protected path', () => {
    // Permission docs, symlinks: "Allow rules: apply only when both the requested path and the
    // file it resolves to match."
    const rule = `Edit(/${layout.profile}/projects/${PROJECT}/settings.json)`;
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('protected path');
    expect(blockOf(result)).toContain(rule);
  });

  it('lets a Markdown file in the auto memory folder through, and flags any other file there', () => {
    // Permission docs, protected paths: "Markdown files in the project's auto memory directory
    // (`~/.claude/projects/<project>/memory/`)" are an exception.
    const markdownRules = [
      `Edit(~/.claude/projects/${PROJECT}/memory/note.md)`,
      `Write(~/.claude/projects/${PROJECT}/memory/*.md)`,
    ];
    writeSettings(markdownRules);

    const allowed = runDoctor();

    expect(blockOf(allowed)).toBe('');
    expect(allowed.status).toBe(0);

    const other = `Write(~/.claude/projects/${PROJECT}/memory/data.json)`;
    writeSettings([...markdownRules, other]);

    const flagged = runDoctor();

    expect(flagged.status).toBe(2);
    expect(blockOf(flagged)).toContain('protected path');
    expect(blockOf(flagged)).toContain(other);
    expect(blockOf(flagged)).not.toContain(markdownRules[0]);
  });

  it('passes a non-protected path written with both spellings', () => {
    // Permission docs, symlinks: a path through a symlink is checked as requested and as
    // resolved, so a pair that is outside every protected path is fine either way.
    writeSettings([
      'Edit(~/shared/notes.txt)',
      `Edit(//${layout.home}/shared/notes.txt)`,
      `Edit(/${layout.profile}/shared/notes.txt)`,
    ]);

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });
});

// A rule with a glob is judged by its literal prefix (the part before the first glob) and by
// symlinks, never by expanding the glob against the folder listing. A glob whose literal prefix
// is an exception folder but whose target is not narrowed to Markdown is only partly protected:
// the finding suggests the Markdown form instead of removing the rule.
describe('scripts/checks/permission-doctor.sh: glob rules', () => {
  it.each([
    ['projects/**/memory/**', 'projects/*/memory/**/*.md'],
    ['agent-memory/**', 'agent-memory/**/*.md'],
  ])('reports %s as partly protected and suggests the Markdown form', (tail, narrowed) => {
    const rule = `Edit(//${layout.home}/.claude/${tail})`;
    const replacement = `Edit(//${layout.home}/.claude/${narrowed})`;
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('partly protected');
    expect(blockOf(result)).toContain(rule);
    expect(blockOf(result)).toContain(`"replace":${JSON.stringify(rule)}`);
    expect(blockOf(result)).toContain(`"with":${JSON.stringify(replacement)}`);
    expect(blockOf(result)).not.toContain('"remove"');
  });

  it.each([
    ['Edit(//HOME/.claude/projects/*/memory/**/*.md)'],
    ['Edit(//HOME/.claude/agent-memory/**/*.md)'],
  ])('passes the Markdown-narrowed rule %s', (template) => {
    writeSettings([template.replace('HOME', layout.home)]);

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    ['an absolute rule', (home: string) => `Edit(//${home}/repo/*)`],
    ['a home rule with a glob folder', () => 'Edit(~/repo/*/x.ts)'],
  ])('does not expand the glob of %s into the .git folder it would list', (_title, rule) => {
    mkdirSync(join(layout.home, 'repo/.git'), { recursive: true });
    writeSettings([rule(layout.home)]);

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });

  it('still removes a rule for a protected file with no glob', () => {
    const rule = `Edit(//${layout.home}/.claude/settings.json)`;
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('protected path');
    expect(blockOf(result)).toContain(`"remove":${JSON.stringify(rule)}`);
    expect(blockOf(result)).not.toContain('partly protected');
  });
});

// The documented exceptions are anchored to <home>/.claude (or CLAUDE_CONFIG_DIR): a copy of the
// same folder names under a project is protected.
describe('scripts/checks/permission-doctor.sh: exception anchors', () => {
  it.each([
    ['a memory folder nested below the project folder', `.claude/projects/p/sub/memory/x.md`],
    ['a project-level plans folder', `repo/.claude/plans/x.md`],
  ])('flags %s', (_title, tail) => {
    const rule = `Edit(//${layout.home}/${tail})`;
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('protected path');
    expect(blockOf(result)).toContain(rule);
  });

  it.each([
    ['a memory folder directly under the project folder', `.claude/projects/p/memory/x.md`],
    ['the home plans folder', `.claude/plans/x.md`],
  ])('passes %s', (_title, tail) => {
    writeSettings([`Edit(//${layout.home}/${tail})`]);

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });
});

// A `**` or `?` in a slot of the exception prefix makes the folders behind it unknown, so a rule
// reaching a documented exception only partly is never a false remove.
describe('scripts/checks/permission-doctor.sh: ** slots and ? segments', () => {
  it.each([
    ['Edit(~/.claude/jobs/**)'],
    ['Edit(~/.claude/projects/**)'],
    ['Edit(~/.claude/projects/**/*.md)'],
    ['Edit(~/.claude/jobs/**/tmp/**)'],
  ])('reports %s as partly protected, never remove', (rule) => {
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('partly protected');
    expect(blockOf(result)).not.toContain('"remove"');
  });

  it('still reports a fully protected rule with a ** as a protected path to remove', () => {
    const rule = 'Edit(~/.claude/agents/**)';
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('protected path');
    expect(blockOf(result)).toContain(`"remove":${JSON.stringify(rule)}`);
    expect(blockOf(result)).not.toContain('partly protected');
  });

  it('removes a rule with a ? segment that can only name a protected file', () => {
    const rule = 'Edit(~/.claude/?/x)';
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain(`"remove":${JSON.stringify(rule)}`);
  });

  it('gives a ? memory file name no ?.md narrowing', () => {
    const rule = `Edit(~/.claude/projects/p/memory/?)`;
    writeSettings([rule]);

    const result = runDoctor();

    expect(blockOf(result)).not.toContain('?.md');
    expect(blockOf(result)).toContain('"remove"');
  });
});

// A rule already ending in .md is a Markdown form: the suggestion only rewrites the project slot.
describe('scripts/checks/permission-doctor.sh: the Markdown suggestion for a .md rule', () => {
  it.each([
    ['Edit(~/.claude/projects/**/memory/**/*.md)', 'Edit(~/.claude/projects/*/memory/**/*.md)'],
    ['Edit(~/.claude/projects/**/memory/*.md)', 'Edit(~/.claude/projects/*/memory/*.md)'],
  ])('suggests %s as %s', (rule, replacement) => {
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain(`"with":${JSON.stringify(replacement)}`);
    expect(blockOf(result)).not.toContain('.md.md');
  });

  it('never suggests note.md.md for a named Markdown file behind a ** project slot', () => {
    writeSettings(['Edit(~/.claude/projects/**/memory/note.md)']);

    const result = runDoctor();

    expect(blockOf(result)).not.toContain('.md.md');
    expect(blockOf(result)).toContain('"with":"Edit(~/.claude/projects/*/memory/note.md)"');
  });
});

// A rule ending at the .claude folder itself is partly protected and gets the hand fix, never an
// unrelated `.claude.md` file.
describe('scripts/checks/permission-doctor.sh: a rule ending at the .claude folder', () => {
  it.each([['Edit(~/.claude)'], ['Edit(//HOME/.claude)']])(
    'never suggests .claude.md for %s',
    (template) => {
      const rule = template.replace('HOME', layout.home.slice(1));
      writeSettings([rule]);

      const result = runDoctor();

      expect(result.status).toBe(2);
      expect(blockOf(result)).toContain('partly protected');
      expect(blockOf(result)).not.toContain('.claude.md');
      expect(blockOf(result)).toContain('"fix"');
      expect(blockOf(result)).not.toContain('"remove"');
    },
  );
});

// A `[..]` class matches one character, so a class segment can spell a protected folder's name.
describe('scripts/checks/permission-doctor.sh: bracket classes in a folder segment', () => {
  it.each([['Edit(~/.claude/[ab]gents)'], ['Edit(~/.claude/age[n]ts)']])(
    'removes %s, it can only name the protected agents folder',
    (rule) => {
      writeSettings([rule]);

      const result = runDoctor();

      expect(result.status).toBe(2);
      expect(blockOf(result)).toContain(`"remove":${JSON.stringify(rule)}`);
      expect(blockOf(result)).not.toContain('partly protected');
    },
  );

  it('does not remove Edit(~/.claude/[p]lans), a class that can name an exception folder', () => {
    writeSettings(['Edit(~/.claude/[p]lans)']);

    const result = runDoctor();

    expect(blockOf(result)).toContain('partly protected');
    expect(blockOf(result)).not.toContain('"remove"');
  });
});

// A trailing slash names the folder, so the suggestion narrows to its Markdown files and never
// appends a bare `.md` segment after the slash.
describe('scripts/checks/permission-doctor.sh: a trailing-slash folder rule', () => {
  it.each([
    ['agent-memory/', 'Edit(~/.claude/agent-memory/**/*.md)'],
    ['projects/**/memory/', 'Edit(~/.claude/projects/*/memory/**/*.md)'],
  ])('suggests the Markdown form for %s', (tail, narrowed) => {
    writeSettings([`Edit(~/.claude/${tail})`]);

    const result = runDoctor();

    expect(blockOf(result)).toContain(`"with":${JSON.stringify(narrowed)}`);
    expect(blockOf(result)).not.toContain('/.md"');
  });

  it('never suggests a /.md segment for Edit(~/.claude/projects/p/memory/)', () => {
    writeSettings(['Edit(~/.claude/projects/p/memory/)']);

    const result = runDoctor();

    expect(blockOf(result)).not.toContain('/.md"');
  });
});

// A rule is read as a folder rule (gitignore reading): when its match can be an exception folder
// or an ancestor of one, it covers that folder's files.
describe('scripts/checks/permission-doctor.sh: rules that can name an exception folder', () => {
  it.each([['Edit(~/.claude/plans)'], ['Edit(~/.claude/jobs/*/tmp)']])(
    'passes %s, every file it covers is exempt',
    (rule) => {
      writeSettings([rule]);

      const result = runDoctor();

      expect(blockOf(result)).toBe('');
      expect(result.status).toBe(0);
    },
  );

  it.each([['Edit(~/.claude/plan?)'], ['Edit(~/.claude/pla*)'], ['Edit(~/.claude/jobs/*/tm?)']])(
    'reports %s as partly protected, never remove, a glob can also name a protected folder',
    (rule) => {
      writeSettings([rule]);

      const result = runDoctor();

      expect(result.status).toBe(2);
      expect(blockOf(result)).toContain('partly protected');
      expect(blockOf(result)).not.toContain('"remove"');
    },
  );

  it.each([
    ['Edit(~/.claude/jobs)'],
    ['Edit(~/.claude/jobs/x)'],
    ['Edit(~/.claude/projects/p/memory)'],
    ['Edit(~/.claude/*)'],
  ])('reports %s as partly protected, never remove', (rule) => {
    writeSettings([rule]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('partly protected');
    expect(blockOf(result)).not.toContain('"remove"');
  });

  it.each([['Edit(~/.claude/agents)'], ['Edit(~/.claude/hooks)']])(
    'still removes %s, a fully protected folder',
    (rule) => {
      writeSettings([rule]);

      const result = runDoctor();

      expect(result.status).toBe(2);
      expect(blockOf(result)).toContain(`"remove":${JSON.stringify(rule)}`);
      expect(blockOf(result)).not.toContain('partly protected');
    },
  );
});

describe('scripts/checks/permission-doctor.sh: a symlinked .claude folder', () => {
  it.each([['Edit(~/.claude/plans/**)'], ['Edit(~/.claude/projects/*/memory/*.md)']])(
    'passes %s when <home>/.claude is a symlink',
    (rule) => {
      const target = join(layout.working, 'dot');
      mkdirSync(join(target, '.claude/projects', PROJECT, 'memory'), { recursive: true });
      mkdirSync(join(target, '.claude/plans'), { recursive: true });
      const linkedHome = realpathSync(createTemporaryDirectory('permission-doctor-linked-'));
      symlinkSync(join(target, '.claude'), join(linkedHome, '.claude'));
      layout = { ...layout, home: linkedHome };
      layout.homeSettings = join(linkedHome, '.claude/settings.json');
      writeSettings([rule]);

      const result = runDoctor();

      expect(blockOf(result)).not.toContain('"remove"');
      expect(blockOf(result)).toBe('');
      expect(result.status).toBe(0);
    },
  );
});

describe('scripts/checks/permission-doctor.js: a crash', () => {
  it('exits 3 from the checker and 2 from the wrapper for one rule of 30000 segments', () => {
    const rule = `Edit(~/${Array.from({ length: 30000 }, () => 'a').join('/')})`;
    writeSettings([rule]);
    const env = {
      PATH: process.env.PATH,
      HOME: layout.home,
      CLAUDE_CONFIG_DIR: layout.profile,
    };

    const checker = spawnSync('node', [CHECKER], { encoding: 'utf8', cwd: layout.working, env });
    const wrapper = runDoctor();
    const what = blockOf(wrapper)
      .split('\n')
      .find((line) => line.startsWith('WHAT FAILED:'));

    expect(checker.status).toBe(3);
    expect(wrapper.status).toBe(2);
    expect(what).toContain('could not run');
    expect(what).not.toContain('cannot work');
  });
});

describe('scripts/checks/permission-doctor.sh: checker failure', () => {
  const whatOf = (result: SpawnSyncReturns<string>): string | undefined =>
    blockOf(result)
      .split('\n')
      .find((line) => line.startsWith('WHAT FAILED:'));

  it('reports a checker that crashes as could not run, not as rules that cannot work', () => {
    writeSettings(['Edit(~/shared/notes.txt)']);
    const stubs = join(layout.working, 'stubs');
    mkdirSync(stubs);
    writeExecutable(
      join(stubs, 'node'),
      '#!/bin/sh\necho "TypeError: crashed at permission-doctor.js:1" >&2\nexit 3\n',
    );

    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      cwd: layout.working,
      env: {
        PATH: `${stubs}:${process.env.PATH}`,
        HOME: layout.home,
        CLAUDE_CONFIG_DIR: layout.profile,
      },
    });

    expect(result.status).toBe(2);
    expect(whatOf(result)).toContain('could not run');
    expect(whatOf(result)).not.toContain('cannot work');
    expect(blockOf(result)).toContain('TypeError: crashed');
  });

  it('still says rules cannot work for a real findings run', () => {
    writeSettings(['Edit(~/.claude/agents/helper.md)']);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(whatOf(result)).toContain('cannot work');
    expect(whatOf(result)).not.toContain('could not run');
  });
});

describe('scripts/checks/permission-doctor.sh: path forms', () => {
  it('flags a single-slash absolute-looking rule and suggests the double-slash form', () => {
    // Permission docs, path patterns: "`/path` Path relative to the settings source" and
    // "`//path` Absolute path from filesystem root".
    const absolute = `${layout.home}/shared/**`;
    writeSettings([`Edit(${absolute})`]);

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('path form');
    expect(blockOf(result)).toContain(`Edit(${absolute})`);
    expect(blockOf(result)).toContain(`Edit(/${absolute})`);
  });

  it('passes the double-slash, home and relative forms of the same location', () => {
    // Permission docs, path patterns: the four types are `//path`, `~/path`, `/path`, `./path`.
    writeSettings([`Edit(//${layout.home}/shared/**)`, 'Edit(~/shared/**)', 'Edit(./shared/**)']);

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('scripts/checks/permission-doctor.sh: drift between the user settings files', () => {
  it('lists each rule that only one of the two files holds', () => {
    // Permission docs, CLAUDE_CONFIG_DIR: user settings are "`~/.claude/settings.json`, or
    // `$CLAUDE_CONFIG_DIR/settings.json` when `CLAUDE_CONFIG_DIR` is set": one of two is read.
    writeSettings(
      ['Edit(~/shared/shared.txt)', 'Edit(~/shared/home-only.txt)'],
      ['Edit(~/shared/shared.txt)', 'Edit(~/shared/profile-only.txt)'],
    );

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('drift');
    expect(blockOf(result)).toContain('Edit(~/shared/home-only.txt)');
    expect(blockOf(result)).toContain('Edit(~/shared/profile-only.txt)');
    expect(blockOf(result)).not.toContain('Edit(~/shared/shared.txt)');
  });
});

describe('scripts/checks/permission-doctor.sh: quiet and failing runs', () => {
  it('is silent with exit 0 when CLAUDE_CONFIG_DIR is unset and the settings are clean', () => {
    // Permission docs, CLAUDE_CONFIG_DIR: with it unset the only user settings file is
    // `~/.claude/settings.json`.
    writeFileSync(layout.homeSettings, settingsOf(['Edit(~/shared/notes.txt)']));

    const result = runDoctor(false);

    expect(result.stdout).toBe('');
    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });

  it('ignores a profile settings file that does not exist', () => {
    // Permission docs, CLAUDE_CONFIG_DIR: the profile file is read "when `CLAUDE_CONFIG_DIR` is
    // set", and a profile may have none.
    writeFileSync(layout.homeSettings, settingsOf(['Edit(~/shared/notes.txt)']));

    const result = runDoctor();

    expect(blockOf(result)).toBe('');
    expect(result.status).toBe(0);
  });

  it('prints the standard block and exits 2 for a settings file that is not valid JSON', () => {
    // Permission docs, CLAUDE_CONFIG_DIR: a user settings file that cannot be parsed cannot be
    // checked, so the doctor reports it rather than reading it as clean.
    writeFileSync(layout.homeSettings, '{ "permissions": { "allow": [ ');
    writeFileSync(layout.profileSettings, settingsOf([]));

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(blockOf(result)).toContain('CHECK FAILED');
    expect(blockOf(result)).toContain(layout.homeSettings);
  });

  it('writes nothing: every settings file keeps its bytes and its modification time', () => {
    // Permission docs, protected paths: ".claude" is protected, so the doctor only reports.
    writeSettings(
      ['Edit(~/.claude/agents/helper.md)', `Edit(${layout.home}/shared/**)`],
      ['Edit(~/shared/other.txt)'],
    );
    const files = [layout.homeSettings, layout.profileSettings];
    files.forEach((file) => {
      utimesSync(file, FIXED_MODIFICATION_SECONDS, FIXED_MODIFICATION_SECONDS);
    });
    const snapshot = (): string[] =>
      files.map((file) => `${readFileSync(file, 'utf8')}@${statSync(file).mtimeMs}`);
    const before = snapshot();

    const result = runDoctor();

    expect(result.status).toBe(2);
    expect(snapshot()).toEqual(before);
  });
});

describe('scripts/checks/permission-doctor.js: dependencies', () => {
  it('requires only node: built-ins', () => {
    const source = readTextFile(CHECKER);
    const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
      (match) => match[1],
    );

    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
