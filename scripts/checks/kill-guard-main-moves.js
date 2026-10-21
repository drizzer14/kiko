// The git commands that move the branch `main`, for kill-guard.js. The main checkout moves only
// through `bash scripts/ff-main.sh <sha>`, after a queued verify passed on the commit; anything
// else that moves the ref is the finding `mainMove`.
//
// Two scopes. A `reset`, `symbolic-ref HEAD <ref>` and `update-ref HEAD` (without `--no-deref`)
// move the branch of the work tree they run in, so they count only against the main checkout. A
// command that writes the ref by name (`update-ref`, `checkout -B`, `switch -C`,
// `branch -m|-f|-d`, `fetch`/`push` into it, `symbolic-ref refs/heads/main`, `worktree add -B`)
// moves it from any worktree of this repository, since every worktree shares the refs, so it
// counts against the whole repository. In both scopes a place the text cannot name fails closed,
// even when the command assigns the variable it comes from. An unrelated repository or a plain
// folder is no target. Pure functions: kill-guard.js passes the parsed git invocations and the
// probes.
//
// Not judged: a ref held in a variable, `update-ref --stdin`, an abbreviated long option, and a
// push to a remote (it moves the remote, not this repository).

const HEAD_NAMES = new Set(['head', '@']);

// `main` as a branch name, and as a ref name (`heads/main`, `refs/heads/main`); the ref file of a
// case-insensitive volume folds case.
const isMainBranch = (name) => name !== undefined && /^main$/i.test(name);
const isMainRef = (name) => name !== undefined && /^(?:(?:refs\/)?heads\/)?main$/i.test(name);

const beforeDashes = (parameters) => {
  const dashes = parameters.indexOf('--');

  return dashes === -1 ? parameters : parameters.slice(0, dashes);
};

// The words that are no option, with the value of each `valueOptions` entry (given as its own
// word) skipped; everything after `--` is an operand.
function operandsOf(parameters, valueOptions = new Set()) {
  const operands = [];
  let index = 0;
  while (index < parameters.length) {
    const word = parameters[index];
    if (word === '--') return [...operands, ...parameters.slice(index + 1)];
    if (!word.startsWith('-')) operands.push(word);
    index += valueOptions.has(word) ? 2 : 1;
  }

  return operands;
}

// The values given to a short option that takes one: glued (`-Bmain`) or the next word, alone or
// ending a group (`-fB main`). `valueLetters` are all the short options that take a value, so a
// glued value is not read as more letters; only `recordLetters` are collected. `longNames` are
// the long spellings (`--force-create main`, `--force-create=main`).
function optionValues(parameters, options) {
  return beforeDashes(parameters).flatMap((word, index) => {
    const next = parameters[index + 1];
    if (word.startsWith('--')) return longOptionValue(word, next, options.longNames);

    return word.startsWith('-') ? shortOptionValue(word, next, options) : [];
  });
}

function longOptionValue(word, next, longNames) {
  const equals = word.indexOf('=');
  if (!longNames.includes(equals === -1 ? word : word.slice(0, equals))) return [];

  return [equals === -1 ? next : word.slice(equals + 1)];
}

function shortOptionValue(word, next, { valueLetters, recordLetters }) {
  const letters = [...word.slice(1)];
  const at = letters.findIndex((letter) => valueLetters.includes(letter));
  if (at === -1 || !recordLetters.includes(letters[at])) return [];
  const glued = letters.slice(at + 1).join('');

  return [glued === '' ? next : glued];
}

const hasShortLetter = (parameters, letters) =>
  beforeDashes(parameters).some(
    (word) => /^-[^-]/.test(word) && [...word.slice(1)].some((letter) => letters.includes(letter)),
  );

const hasLongOption = (parameters, names) =>
  beforeDashes(parameters).some((word) => names.includes(word.split('=')[0]));

// `git help reset` (2.38): with a commit operand and no pathspec, every mode moves the branch.
// A pathspec after `--`, `-p`/`--patch`, or `--pathspec-from-file` only updates the index. With
// no `--`, a lone operand that is an existing path is a pathspec (git refuses one that is both a
// commit and a path, so the probe lets no move through). `HEAD` and `@` name the current commit,
// which `--hard` resets in place. `HEAD~0` is not special-cased: it is denied.
function resetMovesBranch(git, pathExists) {
  const before = beforeDashes(git.arguments);
  const hasDashes = before.length !== git.arguments.length;
  if (git.arguments.length > before.length + 1) return false;
  if (hasShortLetter(before, 'p') || hasLongOption(before, ['--patch', '--pathspec-from-file'])) {
    return false;
  }
  const operands = before.filter((word) => !word.startsWith('-'));
  if (operands.length !== 1 || HEAD_NAMES.has(operands[0].toLowerCase())) return false;

  return hasDashes || !pathExists(git.directory, operands[0]);
}

// `branch` writes `main` when it forces it (`-f main X`), moves or renames onto it or away from it
// (`-m|-M`), force-copies onto it (`-C x main`), or deletes it. `branch -f x main` and
// `branch -c main x` only read it.
function branchNamesMain(parameters) {
  const names = operandsOf(parameters);
  const hasLetter = (letters) => hasShortLetter(parameters, letters);
  const hasLong = (long) => hasLongOption(parameters, [long]);
  const forces = hasLetter('f') || hasLong('--force');
  const copies = hasLetter('cC') || hasLong('--copy');
  if (hasLetter('dD') || hasLong('--delete') || hasLetter('mM') || hasLong('--move')) {
    return names.some(isMainBranch);
  }
  if (copies && (hasLetter('C') || forces)) return isMainBranch(names.at(-1));

  return forces && isMainBranch(names[0]);
}

const PUSH_VALUE_OPTIONS = new Set([
  '--repo',
  '--receive-pack',
  '--exec',
  '-o',
  '--push-option',
  '--signed',
]);
const LOCAL_REPOSITORY = /^(?:\.\.?(?:\/|$)|\/|~|file:)/;

const MAIN_SPELLINGS = ['main', 'heads/main', 'refs/heads/main'];

const escapeRegularExpression = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// A destination glob (`refs/heads/*`) names every ref it matches, `main` among them.
function globMatchesMain(destination) {
  if (!destination.includes('*')) return false;
  const pattern = new RegExp(
    `^${destination.split('*').map(escapeRegularExpression).join('.*')}$`,
    'i',
  );

  return MAIN_SPELLINGS.some((spelling) => pattern.test(spelling));
}

// A refspec `[+]<source>:<destination>` writes its destination in the repository it is fetched
// into or pushed to. The words after the repository are all read as refspecs, so the value of an
// option that takes one (a fetch's `--depth 1`) is only a refspec without a colon. Push counts
// only into a local repository (`.` or a path) and skips the values of its own options.
function refspecWritesMain(parameters, valueOptions = new Set(), localOnly = false) {
  const [repository, ...refspecs] = operandsOf(parameters, valueOptions);
  if (repository === undefined || (localOnly && !LOCAL_REPOSITORY.test(repository))) return false;

  return refspecs.some(destinationIsMain);
}

function destinationIsMain(refspec) {
  const colon = refspec.indexOf(':');
  const destination = refspec.slice(colon + 1);

  return colon !== -1 && (isMainRef(destination) || globMatchesMain(destination));
}

const FETCH_VALUE_OPTIONS = new Set(['--refmap']);
const REFMAP_OPTION = { valueLetters: '', recordLetters: '', longNames: ['--refmap'] };

// Measured on git 2.38.1: `git fetch -u --refmap=refs/heads/feat:refs/heads/main . feat` and the
// two-word `--refmap <value>` both move `main`, because a refmap maps the ref a command-line
// refspec fetches to its destination; a glob refmap (`refs/heads/*:refs/heads/*`) writes `main`
// when the fetched ref is `main` (from a remote, `fetch -u origin main`); a refmap to
// `refs/remotes/x/*` and an empty `--refmap=` (it only drops the configured refspecs) write nothing
// in `refs/heads`; and a `--refmap` with no refspec is a fatal error. A destination that can be
// `main` counts, whichever ref the refspec fetches.
function fetchWritesMain(parameters) {
  const refmaps = optionValues(parameters, REFMAP_OPTION).filter((value) => value !== undefined);

  return refspecWritesMain(parameters, FETCH_VALUE_OPTIONS) || refmaps.some(destinationIsMain);
}

const UPDATE_REF_VALUE_OPTIONS = new Set(['-m']);
const CHECKOUT_BRANCH_OPTIONS = { valueLetters: 'bB', recordLetters: 'B', longNames: [] };
const SWITCH_BRANCH_OPTIONS = {
  valueLetters: 'cC',
  recordLetters: 'C',
  longNames: ['--force-create'],
};

// `update-ref` writes the ref it names; `HEAD` is a symbolic ref, so unless `--no-deref` is given
// it writes the branch the work tree is on (the file of a case-insensitive volume folds case).
function updateRefScope(parameters) {
  const [name] = operandsOf(parameters, UPDATE_REF_VALUE_OPTIONS);
  if (isMainRef(name)) return 'repository';
  const writesBranchOfHead =
    name?.toLowerCase() === 'head' && !hasLongOption(parameters, ['--no-deref']);

  return writesBranchOfHead ? 'mainCheckout' : null;
}

// Which place a command moves `main` in: `'repository'` for a command that writes the ref by
// name, `'mainCheckout'` for one that moves the branch of the work tree it runs in, or null.
function moveScope(git, pathExists) {
  const { subcommand, arguments: parameters } = git;
  if (subcommand === 'reset') return resetMovesBranch(git, pathExists) ? 'mainCheckout' : null;
  if (subcommand === 'symbolic-ref') {
    const [target, source] = operandsOf(parameters, UPDATE_REF_VALUE_OPTIONS);
    if (source === undefined) return null;
    if (isMainRef(target)) return 'repository';

    return target === 'HEAD' ? 'mainCheckout' : null;
  }
  if (subcommand === 'update-ref') return updateRefScope(parameters);
  const namesMain = {
    checkout: () => optionValues(parameters, CHECKOUT_BRANCH_OPTIONS).some(isMainBranch),
    switch: () => optionValues(parameters, SWITCH_BRANCH_OPTIONS).some(isMainBranch),
    branch: () => branchNamesMain(parameters),
    fetch: () => fetchWritesMain(parameters),
    push: () => refspecWritesMain(parameters, PUSH_VALUE_OPTIONS, true),
    worktree: () =>
      parameters[0] === 'add' &&
      optionValues(parameters.slice(1), CHECKOUT_BRANCH_OPTIONS).some(isMainBranch),
  }[subcommand];

  return namesMain?.() ? 'repository' : null;
}

// A ref-name command writes the repository its git directory names, else the one its work tree
// is in; the work tree and the git directory both count for a command bound to a checkout. With
// no work tree option git takes the folder it runs in as the work tree, so a folder the text cannot
// name next to a git directory it can name leaves only that git directory: an unrelated repository
// is no target (a git directory or a work tree the text cannot name still fails closed).
function placesOf(git, scope) {
  const [workTree, gitDirectory] = git.targets;
  if (!git.hasGitDirectory) return git.targets;
  if (scope === 'repository') return [gitDirectory];
  const runsInUnknownFolder = workTree === null && !git.hasWorkTree && gitDirectory !== null;

  return runsInUnknownFolder ? [gitDirectory] : git.targets;
}

const UNRESOLVED_PLACE = 'a folder the command does not name';

// The folder where a git command moves `main`, the text `UNRESOLVED_PLACE` for a command, in
// either scope, that runs where the text cannot say, or null. `invocations` hold one entry per
// folder the command may run in. `helpers`: `isMainCheckout(folder)`, `isInRepository(folder)`,
// and `pathExists(folder, operand)`.
function mainMoveTarget(invocations, helpers) {
  for (const git of invocations) {
    const scope = moveScope(git, helpers.pathExists);
    const target = scope === null ? null : firstMovedPlace(placesOf(git, scope), scope, helpers);
    if (target !== null) return target;
  }

  return null;
}

function firstMovedPlace(places, scope, helpers) {
  for (const place of places) {
    if (place === null) return UNRESOLVED_PLACE;
    if (helpers.isMainCheckout(place)) return place;
    if (scope === 'repository' && helpers.isInRepository(place)) return place;
  }

  return null;
}

module.exports = { mainMoveTarget };
