#!/usr/bin/env bash
# make jest-affected — the dev test command: runs only the jest suites a change can affect, never
# the whole suite (the queued verify does that).
#
# Usage: jest-affected.sh [<ref>] [--list]
#   <ref>   the base to diff against; the default is `git merge-base HEAD main`
#   --list  print the suites and the checks it would run, and run none
#
# A changed path is sorted into these buckets (a path can land in several):
#   docs       a skill, agent, docs or CLAUDE.md path adds the doc-reading suites
#   rules      a rules/ path adds `npm run check:rules`
#   every      a config that every suite reads (jest, babel, tsconfig, package files, mocks,
#              patches, .env.test) prints a notice and makes the run exit 3, never green, because
#              only the queued verify tests it
#   named      adds every test file that names the path in a quoted literal: this is how a suite
#              reaches a shell script, a spawned checker or a src/ file it reads as text. A path
#              outside src/ and a src/ file jest cannot trace (an asset) also match by basename;
#              an existing src/ code file matches by its full path only. A deleted code file also
#              matches its extensionless import specifier (`/name'`, or the folder name for an
#              index file), since an importer nobody edited still imports it
#   related    an existing .ts/.tsx/.js/.mjs/.json path goes to `jest --findRelatedTests`
# The suites in jest-inventory-suites.txt run on every call that has a change, since they walk a
# tree and see a file no import reaches. A call with no change exits 0 before them.
#
# Exit codes: 2 on a failure block (nothing ran), else the first non-zero code of the jest calls
# and check:rules, else 3 when a path affects every suite, else 0. --list prints the plan and the
# suites and always exits 0, since it runs nothing. The runner never calls jest without a test
# path.
#
# Deliberately `set -uo pipefail`, NOT `set -e`: each call's exit code is kept, and the first
# non-zero one is the result.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd -P)"
# shellcheck source=_lib.sh
. "$DIR/_lib.sh"
cd "$ROOT" || exit 2

INVENTORY_LIST="$DIR/jest-inventory-suites.txt"
SEMGREP_SUITE_LIST="$DIR/semgrep-jest-suites.txt"
JEST="node_modules/.bin/jest"
MAX_WORKERS=2

fail_block() {
  # $1 what  $2 details  $3 why  $4 how to fix
  print_block \
    "jest-affected" \
    "$1" \
    "$2" \
    "$3" \
    "$4" \
    "Do not run a bare jest or the whole suite to get past this; the queued verify runs it."
}

REF=""
LIST_ONLY=0
for argument in "$@"; do
  case "$argument" in
    --list) LIST_ONLY=1 ;;
    -* | '')
      fail_block \
        "An argument this runner does not take." \
        "Argument: '$argument'" \
        "Only a base ref and --list are read, and a leading dash would reach git as an option." \
        "Use: bash scripts/checks/jest-affected.sh [<ref>] [--list]."
      exit 2
      ;;
    *)
      if [ -n "$REF" ]; then
        fail_block \
          "More than one base ref was given." \
          "Refs given: $REF $argument" \
          "The runner diffs against one base, so a second ref would be ignored." \
          "Pass one ref, or none for the merge-base with main."
        exit 2
      fi
      REF="$argument"
      ;;
  esac
done

if [ -z "$REF" ]; then
  BASE="$(git merge-base HEAD main 2>/dev/null)" || BASE=""
  LABEL="merge-base with main"
else
  BASE="$(git rev-parse --verify --quiet "$REF^{commit}" 2>/dev/null)" || BASE=""
  LABEL="$REF"
fi

if [ -z "$BASE" ]; then
  fail_block \
    "The base does not resolve to a commit." \
    "Base: ${REF:-merge-base HEAD main} (nothing was run)" \
    "Without a base the changed paths are unknown, and an empty change set would read as nothing to test." \
    "Pass a ref that exists, for example: make jest-affected BASE=origin/main."
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/jest-affected.XXXXXX")" || exit 2
trap 'rm -rf "$WORK"' EXIT

# Both lists are NUL-separated and read with quotePath off, so a path with a space or a non-ASCII
# letter arrives whole. --no-renames reports a move as a delete plus an add, so the old name is
# mapped too.
if ! git -c core.quotePath=false diff --no-renames --name-only -z "$BASE" -- > "$WORK/tracked" ||
  ! git -c core.quotePath=false ls-files -z --others --exclude-standard > "$WORK/untracked"; then
  fail_block \
    "git could not list the changed paths." \
    "Base: $BASE" \
    "Without the change list the runner cannot tell which suites a change affects." \
    "Run git diff --name-only $BASE by hand and fix what it reports."
  exit 2
fi

cat "$WORK/tracked" "$WORK/untracked" | tr '\0' '\n' | grep -v '^$' | LC_ALL=C sort -u > "$WORK/changed"
CHANGED_COUNT="$(wc -l < "$WORK/changed" | tr -d ' ')"

is_every_suite_path() {
  case "$1" in
    package.json | package-lock.json | jest.config.js | babel.config.js | tsconfig*.json) return 0 ;;
    .env.test | jest/* | __mocks__/* | patches/*) return 0 ;;
  esac
  return 1
}

has_traceable_extension() {
  case "$1" in
    *.ts | *.tsx | *.js | *.mjs | *.json) return 0 ;;
  esac
  return 1
}

# add_name_patterns <literal>... : append each literal, in each quote form, to the pattern file.
add_name_patterns() {
  local literal quote
  for literal in "$@"; do
    for quote in "'" '"' '`'; do
      printf '%s%s%s\n' "$quote" "$literal" "$quote" >> "$WORK/name_patterns"
    done
  done
}

DOC_PATTERN="$(harness_doc_roots_pattern)"
HAS_DOC=0
HAS_RULES=0
HAS_EVERY=0
: > "$WORK/related_paths"
: > "$WORK/name_patterns"

while IFS= read -r path; do
  if [[ "$path" =~ $DOC_PATTERN ]]; then
    HAS_DOC=1
  fi

  case "$path" in rules/*) HAS_RULES=1 ;; esac

  if is_every_suite_path "$path"; then
    HAS_EVERY=1
    printf 'AFFECTS EVERY SUITE: %s (the queued verify tests it)\n' "$path"
  fi

  # A src/ file jest can trace goes to --findRelatedTests, and by its full path only to the suites
  # that read it as text: its basename would match a suite that names an unrelated file of that
  # name. Everything else is mapped by name, because no import links it to the suites that read it.
  if [ -f "$path" ] && has_traceable_extension "$path"; then
    printf '%s\n' "$path" >> "$WORK/related_paths"

    case "$path" in
      src/*)
        add_name_patterns "$path"
        continue
        ;;
    esac
  fi

  add_name_patterns "$path" "$(basename "$path")"

  # A deleted module is not in --findRelatedTests, and an importer nobody edited still names it.
  if [ ! -e "$path" ] && has_traceable_extension "$path"; then
    specifier="$(basename "$path")"
    specifier="${specifier%.*}"

    if [ "$specifier" = index ]; then
      specifier="$(basename "$(dirname "$path")")"
    fi

    if [ "$specifier" != . ] && [ "$specifier" != / ]; then
      for quote in "'" '"' '`'; do
        printf '/%s%s\n' "$specifier" "$quote" >> "$WORK/name_patterns"
      done
    fi
  fi
done < "$WORK/changed"

list_suites() {
  # $1 file of suite paths, one per line: keep the lines that are suite files on disk, sorted
  while IFS= read -r suite; do
    [ -f "$suite" ] && printf '%s\n' "$suite"
  done < "$1" | LC_ALL=C sort -u
}

# A list file holds one exact path per line; comments and blank lines are skipped. A line is
# trimmed first, as the pin in __tests__/jest-affected.test.ts trims it, so an indented entry or a
# trailing space cannot pass the pin and then fail here.
read_list() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) ;; *) printf '%s\n' "$line" ;; esac
  done < "$1"
}

if [ "$CHANGED_COUNT" -eq 0 ]; then
  printf 'jest-affected: base %s (%s), 0 changed, 0 suites (related 0, named 0, docs 0, inventory 0, in band 0)\n' \
    "${BASE:0:12}" "$LABEL"
  echo 'jest-affected: no related suite (nothing changed since the base)'
  exit 0
fi

for list in "$INVENTORY_LIST" "$SEMGREP_SUITE_LIST"; do
  if [ ! -f "$list" ]; then
    fail_block \
      "A suite list is missing." \
      "List: ${list#"$ROOT"/}" \
      "The inventory suites cannot run without their list, and the real-semgrep suites must run in band." \
      "Restore the list: one exact test path per line."
    exit 2
  fi
done

read_list "$INVENTORY_LIST" > "$WORK/inventory_raw"
read_list "$SEMGREP_SUITE_LIST" > "$WORK/semgrep_suites"

while IFS= read -r suite; do
  if [ ! -f "$suite" ]; then
    fail_block \
      "The inventory list names a suite that is not on disk." \
      "Missing suite: $suite" \
      "A stale entry would silently stop a tree-scanning suite from running on every call." \
      "Remove the entry from scripts/checks/jest-inventory-suites.txt, or restore the suite."
    exit 2
  fi
done < "$WORK/inventory_raw"

# jest prints absolute paths; the plan, the list and --runTestsByPath all use paths from the root.
: > "$WORK/related_raw"
if [ -s "$WORK/related_paths" ]; then
  RELATED_ARGUMENTS=()
  while IFS= read -r path; do
    RELATED_ARGUMENTS+=("$path")
  done < "$WORK/related_paths"

  if ! "$JEST" --listTests --findRelatedTests "${RELATED_ARGUMENTS[@]}" > "$WORK/jest_listed"; then
    fail_block \
      "jest could not list the suites related to the changed files." \
      "Command: $JEST --listTests --findRelatedTests <${#RELATED_ARGUMENTS[@]} paths>" \
      "Dropping the related suites would run less than the change needs and still look green." \
      "Fix what jest printed above, then run the command again."
    exit 2
  fi

  awk -v prefix="$ROOT/" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); next } { print }' \
    "$WORK/jest_listed" > "$WORK/related_raw"
fi

: > "$WORK/named_raw"
if [ -s "$WORK/name_patterns" ]; then
  git grep -l --untracked -F -f "$WORK/name_patterns" -- '*.test.ts' '*.test.tsx' \
    > "$WORK/named_raw" 2>/dev/null
fi

: > "$WORK/docs_raw"
if [ "$HAS_DOC" -eq 1 ]; then
  harness_doc_suites "$ROOT" > "$WORK/docs_raw"
fi

: > "$WORK/union"
COUNTS=""
for bucket in related named docs inventory; do
  list_suites "$WORK/${bucket}_raw" > "$WORK/${bucket}_suites"
  # Each suite is credited to the first bucket that holds it, so the counts add up to the total.
  grep -vxF -f "$WORK/union" "$WORK/${bucket}_suites" > "$WORK/${bucket}_new"
  cat "$WORK/${bucket}_new" >> "$WORK/union"
  COUNTS="$COUNTS ${bucket} $(wc -l < "$WORK/${bucket}_new" | tr -d ' '),"
done

LC_ALL=C sort -u "$WORK/union" -o "$WORK/union"
grep -xF -f "$WORK/semgrep_suites" "$WORK/union" > "$WORK/in_band"
grep -vxF -f "$WORK/semgrep_suites" "$WORK/union" > "$WORK/parallel"
SUITE_COUNT="$(wc -l < "$WORK/union" | tr -d ' ')"
IN_BAND_COUNT="$(wc -l < "$WORK/in_band" | tr -d ' ')"
PARALLEL_COUNT="$(wc -l < "$WORK/parallel" | tr -d ' ')"

printf 'jest-affected: base %s (%s), %s changed, %s suites (%s in band %s)\n' \
  "${BASE:0:12}" "$LABEL" "$CHANGED_COUNT" "$SUITE_COUNT" "${COUNTS# }" "$IN_BAND_COUNT"

if [ "$LIST_ONLY" -eq 1 ]; then
  cat "$WORK/union"
  [ "$HAS_RULES" -eq 1 ] && echo 'npm run check:rules'
  exit 0
fi

FIRST_CODE=0

keep_first_failure() {
  if [ "$FIRST_CODE" -eq 0 ]; then
    FIRST_CODE="$1"
  fi
}

if [ "$SUITE_COUNT" -eq 0 ]; then
  echo 'jest-affected: no related suite'
fi

if [ "$PARALLEL_COUNT" -gt 0 ]; then
  PARALLEL_SUITES=()
  while IFS= read -r suite; do
    PARALLEL_SUITES+=("$suite")
  done < "$WORK/parallel"

  # The same tripwire as verify.sh stage 2a: a real-semgrep suite missing from the list fails fast
  # here instead of timing out under load.
  PATH="$DIR/semgrep-tripwire:$PATH" "$JEST" --runTestsByPath "${PARALLEL_SUITES[@]}" \
    --maxWorkers="$MAX_WORKERS"
  keep_first_failure $?
fi

if [ "$IN_BAND_COUNT" -gt 0 ]; then
  IN_BAND_SUITES=()
  while IFS= read -r suite; do
    IN_BAND_SUITES+=("$suite")
  done < "$WORK/in_band"

  "$JEST" --runTestsByPath "${IN_BAND_SUITES[@]}" --runInBand
  keep_first_failure $?
fi

if [ "$HAS_RULES" -eq 1 ]; then
  npm run check:rules
  keep_first_failure $?
fi

if [ "$FIRST_CODE" -ne 0 ]; then
  exit "$FIRST_CODE"
fi

if [ "$HAS_EVERY" -eq 1 ]; then
  echo 'jest-affected: exit 3, the related run is not enough for a path that affects every suite.'
  echo "Queue the full verify: bash scripts/job-queue.sh verify $ROOT <label>"
  exit 3
fi

exit 0
