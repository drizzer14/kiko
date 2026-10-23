#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/jscpd"

if [ ! -x "$BIN" ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "The jscpd tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:dup" \
    "Do not run jscpd through npx without --no-install (that auto-fetches jscpd@5 from the network). Install the pinned version with npm install."
  exit 2
fi

# Scope: paths passed as args (changed-files scope), else the whole repo.
paths=("$@"); whole_repo=0
[ ${#paths[@]} -eq 0 ] && { paths=("."); whole_repo=1; }

# A path that is not on disk (a deleted file) makes jscpd exit non-zero with ENOENT, which
# the blocking run below would report as duplication. Say what is wrong instead.
for p in "$@"; do
  harness_require_path "jscpd (copy/paste detection)" "$p" || exit 2
done

# The ceilings file holds one `<repo-relative path><TAB><percent>` row per tracked large file and
# one row under COMBINED_KEY for the whole-repo combined baseline. It is read before any jscpd
# run, on every run, so a file that is missing or malformed cannot silently turn the large-file
# pass into a pass that checks nothing.
CEILINGS="$DIR/dup-ceilings.tsv"
COMBINED_KEY='*combined*'

# ceilings_problem : prints why the ceilings file cannot be used, and nothing when it can be.
ceilings_problem() {
  [ -f "$CEILINGS" ] || { printf 'the file does not exist.'; return; }
  awk -v combined="$COMBINED_KEY" '
    BEGIN { FS = "\t" }
    /^[[:space:]]*$/ || /^#/ { next }
    problem != "" { next }
    NF != 2 || $1 == "" || $2 !~ /^[0-9]+(\.[0-9]+)?$/ {
      problem = sprintf("line %d is not <path><TAB><percent>: %s", NR, $0)
      next
    }
    ($1 in seen) { problem = sprintf("line %d repeats the path %s", NR, $1); next }
    { seen[$1] = 1 }
    END {
      if (problem == "" && !(combined in seen)) { problem = "it has no " combined " row." }
      printf "%s", problem
    }
  ' "$CEILINGS"
}

problem="$(ceilings_problem)"
if [ -n "$problem" ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "check:dup cannot read its ceilings file, scripts/checks/dup-ceilings.tsv." \
    "dup-ceilings.tsv: $problem" \
    "The ceilings file decides which large test files may stay duplicated and by how much. Without it every large file would pass unmeasured, and a broken file must not look like a clean tree." \
    "Restore scripts/checks/dup-ceilings.tsv: one <repo-relative path><TAB><percent> row per tracked file and one *combined* row. Re-run: npm run check:dup" \
    "Do not create an empty ceilings file, and do not raise a figure, to get past this."
  exit 2
fi

# ceiling_of <path> : the recorded ceiling text of a listed path, nothing for an unlisted one.
ceiling_of() {
  KEY="$1" awk 'BEGIN { FS = "\t" } !/^#/ && $1 == ENVIRON["KEY"] { print $2; exit }' "$CEILINGS"
}

# A row naming a file that is not on disk is a WARNING: a delete or a rename must not block.
while IFS= read -r listed_path; do
  [ -e "$ROOT/$listed_path" ] ||
    printf 'WARNING: check:dup scripts/checks/dup-ceilings.tsv names %s, which is not on disk; delete or re-point the row.\n' "$listed_path" >&2
done < <(awk -v combined="$COMBINED_KEY" 'BEGIN { FS = "\t" } !/^#/ && NF == 2 && $1 != combined { print $1 }' "$CEILINGS")

# Dedup only an explicit set of files (the changed-files scope), keyed on
# the set identity. jscpd detects duplication within the given set, so its
# result depends only on those files' contents plus .jscpd.json and the
# pinned jscpd version (captured by package-lock.json). The whole-repo
# manual run ("." with no args) always runs.
dkey=""; fp=""; blocking_unchanged=0
if [ "$#" -gt 0 ]; then
  allfiles=1
  for p in "$@"; do [ -f "$p" ] || allfiles=0; done
  if [ "$allfiles" -eq 1 ]; then
    sorted="$(printf '%s\n' "$@" | sort -u)"
    dkey="dup:$(printf '%s' "$sorted" | harness_hash)"
    fp="$( { printf '%s\n' "$sorted" | while IFS= read -r p; do shasum "$p" 2>/dev/null; done
            shasum "$ROOT/.jscpd.json" 2>/dev/null
            shasum "$ROOT/package-lock.json" 2>/dev/null; } | harness_hash )"
    if harness_unchanged "$ROOT" "$dkey" "$fp"; then
      blocking_unchanged=1
    fi
  fi
fi

# An unchanged fingerprint skips only the blocking run below. The large-file pass still runs, so
# every run that sees a large file over the threshold prints its warning, not only the first one.
if [ "$blocking_unchanged" -eq 0 ]; then
  out="$("$BIN" "${paths[@]}" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    print_block \
      "jscpd (copy/paste detection)" \
      "jscpd found duplicated code above the configured threshold." \
      "$out" \
      "Duplicated blocks are a common LLM failure mode: copy-pasting instead of extracting a shared function. Duplication multiplies bug surface and drifts out of sync." \
      "Extract the shared block into one function or module and call it from both places. Re-run: npm run check:dup" \
      "Do not rename a variable to trick jscpd. Extract the shared block into one function."
    exit 2
  fi
  [ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
fi

# Second pass. jscpd skips a file over maxLines (1000) or maxSize (100kb) without a
# word, so the blocking run above never measured those files. Its file selection (the config's
# ignore list, .gitignore, the format filter) is the only thing that knows which files are in
# scope, so ask it: `--debug` lists the selected files and runs no detection. The files in the
# list made with the limits raised but not in the default list are exactly the ones the blocking
# run skipped for size. Each is measured ALONE with the limits raised, because a run of the whole
# set attributes a clone to whichever file jscpd stores first, which makes a file's percentage
# depend on its neighbours. A clone between a large file and ANOTHER file is invisible alone, so
# one more run measures the whole scope together with the limits raised; it needs two files to
# find such a clone, so a scope with one file skips it (it would repeat the alone figure).
# The verdicts come from the ceilings file (dup-ceilings.tsv). A listed file over the threshold
# but at or under its ceiling is a WARNING on stderr (tracked debt, see
# docs/harness/documented-exceptions.md); a listed file above its ceiling, an unlisted file over
# the threshold, a no-argument combined figure above its baseline, and a jscpd failure to list or
# measure all FAIL through print_block with exit 2, because a large file that went unmeasured
# must not read as a clean one.
RAISED_LIMITS=(--max-lines 2147483647 --max-size 1gb)

# is_number <text> : succeeds for a plain non-negative decimal number. Never trust a figure that
# a tool printed until it passes this: a color code or a blank compares as a string.
is_number() {
  case "$1" in
    '' | *[!0-9.]* | .* | *. | *.*.*) return 1 ;;
  esac
}

# listed_files <extra jscpd option>... : one in-scope file path per line, sorted. A jscpd failure
# returns non-zero; an empty scope is a valid empty list.
listed_files() {
  local listing
  listing="$("$BIN" "${paths[@]}" --debug --no-colors "$@" 2>/dev/null)" || return 1
  printf '%s\n' "$listing" | while IFS= read -r line; do
    if [ -f "$line" ]; then printf '%s\n' "$line"; fi
  done | LC_ALL=C sort -u
}

# large_file_block <what failed> <details> : the failure block of this pass, shared by every FAIL
# path. The caller exits 2.
large_file_block() {
  print_block \
    "jscpd (copy/paste detection)" \
    "$1" \
    "$2" \
    "jscpd skips a file over 1000 lines or 100kb in its blocking run, so this pass is the only measurement of the largest test files. A file it could not measure, or that is above its recorded ceiling, must not read as a clean one." \
    "Dedupe the file named above with shared helpers or it.each until bash scripts/checks/dup.sh <file> alone reports a figure at or under its ceiling in scripts/checks/dup-ceilings.tsv (5% for a file that is not listed), then re-run: npm run check:dup. For a jscpd failure, fix the file or the tool it names." \
    "Do not raise a ceiling, add a row to dup-ceilings.tsv, or rename variables to get past this. A row changes only with a reviewer finding that names the cause."
}

# A failure to LIST fails closed: the blocking pass already failed closed on a real jscpd crash,
# and the large files must not go unmeasured without a trace.
if ! default_list="$(listed_files)" || ! raised_list="$(listed_files "${RAISED_LIMITS[@]}")"; then
  large_file_block \
    "check:dup could not list the files it skipped for size: jscpd --debug failed." \
    "jscpd --debug exited non-zero while listing the files in scope, so the large files were not measured."
  exit 2
fi
skipped="$(LC_ALL=C comm -13 <(printf '%s\n' "$default_list") <(printf '%s\n' "$raised_list"))"
[ -z "$skipped" ] && exit 0

# process.stdout.write keeps a number bare under FORCE_COLOR, which the print flag of node does
# not (kiko-linter "Never use the print flag of node in a shell script").
threshold="$(node -e 'process.stdout.write(String(require(process.argv[1]).threshold))' "$ROOT/.jscpd.json" 2>/dev/null)"
is_number "$threshold" || threshold=5
report_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-dup-large.XXXXXX")" || {
  large_file_block \
    "check:dup could not measure the files it skipped for size: mktemp failed." \
    "mktemp could not create a report directory under ${TMPDIR:-/tmp}, so the large files were not measured."
  exit 2
}
trap 'rm -rf "$report_dir"' EXIT
root_real="$(cd "$ROOT" && pwd -P)"

# measure <report name> <jscpd argument>... : runs jscpd with the limits raised and prints the
# total percentage it measured. Returns 1 when jscpd failed, 2 when it printed no usable figure.
measure() {
  local name="$1" value
  shift
  # --threshold 100 keeps jscpd's own threshold reporter from exiting non-zero on a big
  # percentage, so a non-zero exit here means jscpd itself failed.
  "$BIN" "$@" --silent --no-colors -r json -o "$report_dir/$name" -t 100 "${RAISED_LIMITS[@]}" \
    >/dev/null 2>&1 || return 1
  value="$(node -e 'const total = require(process.argv[1]).statistics.total; process.stdout.write(total.lines > 0 ? String(total.percentage) : "")' "$report_dir/$name/jscpd-report.json" 2>/dev/null)"
  is_number "$value" || return 2
  printf '%s' "$value"
}

# above <percentage> <limit> : succeeds when the figure is over the limit.
above() {
  awk -v p="$1" -v t="$2" 'BEGIN { exit !(p > t) }'
}

# over_threshold <percentage> : succeeds when the figure is over the threshold.
over_threshold() {
  above "$1" "$threshold"
}

# measure_one <number> <file> : writes the file's WARNING line, if any, to
# "$report_dir/<number>.warning" and its FAIL line, if any, to "$report_dir/<number>.failure".
measure_one() {
  local number="$1" file="$2" shown measured status ceiling
  shown="${file#"$ROOT"/}"
  shown="${shown#"$root_real"/}"
  measured="$(measure "$number" "$file")"
  status=$?
  ceiling="$(ceiling_of "$shown")"
  if [ "$status" -eq 1 ]; then
    printf 'check:dup could not measure %s: jscpd failed on it.\n' "$shown" > "$report_dir/$number.failure"
  elif [ "$status" -ne 0 ]; then
    printf 'check:dup could not measure %s: jscpd produced no figure for it.\n' "$shown" > "$report_dir/$number.failure"
  elif [ -n "$ceiling" ] && above "$measured" "$ceiling"; then
    printf 'check:dup %s measured alone is %s%% duplicated, above its %s%% ceiling in scripts/checks/dup-ceilings.tsv.\n' \
      "$shown" "$measured" "$ceiling" > "$report_dir/$number.failure"
  elif ! over_threshold "$measured"; then
    return
  elif [ -n "$ceiling" ]; then
    printf 'WARNING: check:dup %s is over jscpd'\''s size limit (1000 lines or 100kb), so the blocking run skipped it; measured alone it is %s%% duplicated (threshold %s%%). It is listed in scripts/checks/dup-ceilings.tsv and is at or under its ceiling there.\n' \
      "$shown" "$measured" "$threshold" > "$report_dir/$number.warning"
  else
    printf 'check:dup %s is over jscpd'\''s size limit (1000 lines or 100kb) and measured alone is %s%% duplicated (threshold %s%%); it is not in scripts/checks/dup-ceilings.tsv, so it is a new regression.\n' \
      "$shown" "$measured" "$threshold" > "$report_dir/$number.failure"
  fi
}

# measure_combined : the whole scope together, writing its WARNING line, if any, to
# "$report_dir/combined.warning" and its FAIL line, if any, to "$report_dir/combined.failure".
# Only the no-argument run is held to the baseline: a scoped run's combined figure is not
# comparable with it.
measure_combined() {
  local measured status baseline
  measured="$(measure combined "${paths[@]}")"
  status=$?
  baseline="$(ceiling_of "$COMBINED_KEY")"
  if [ "$status" -ne 0 ]; then
    printf 'check:dup could not measure the combined run (every file in scope, size limits raised).\n' > "$report_dir/combined.failure"
  elif [ "$whole_repo" -eq 1 ] && above "$measured" "$baseline"; then
    printf 'check:dup combined run (every file in scope, size limits raised) is %s%% duplicated, above its %s%% baseline in scripts/checks/dup-ceilings.tsv.\n' \
      "$measured" "$baseline" > "$report_dir/combined.failure"
  elif over_threshold "$measured"; then
    printf 'WARNING: check:dup combined run (every file in scope, size limits raised) is %s%% duplicated (threshold %s%%); a clone between a large file and another file counts only here. The baseline in scripts/checks/dup-ceilings.tsv applies to the no-argument (whole-repo) run only, and a whole-repo figure above it fails.\n' \
      "$measured" "$threshold" > "$report_dir/combined.warning"
  fi
}

# Four measurements at a time: one jscpd start costs about half a second, and a whole-repo run
# has dozens of large files. The warnings print in file order afterwards, so the output does not
# depend on which measurement finishes first. The combined run starts first, beside the batches;
# a batch waits only for its own process ids, so a long combined run never stalls batch 2 and on.
combined_pid=''
if [ "$(printf '%s\n' "$raised_list" | wc -l)" -gt 1 ]; then
  measure_combined &
  combined_pid=$!
fi
n=0
batch_pids=()
while IFS= read -r file; do
  n=$((n + 1))
  measure_one "$n" "$file" &
  batch_pids+=("$!")
  if [ $((n % 4)) -eq 0 ]; then
    wait "${batch_pids[@]}"
    batch_pids=()
  fi
done <<< "$skipped"
[ "${#batch_pids[@]}" -gt 0 ] && wait "${batch_pids[@]}"
[ -n "$combined_pid" ] && wait "$combined_pid"
failures=''
for name in $(seq 1 "$n") combined; do
  [ -f "$report_dir/$name.failure" ] && failures="$failures$(cat "$report_dir/$name.failure")"$'\n'
done
for ((i = 1; i <= n; i++)); do
  [ -f "$report_dir/$i.warning" ] && cat "$report_dir/$i.warning" >&2
done
[ -f "$report_dir/combined.warning" ] && cat "$report_dir/combined.warning" >&2
[ -z "$failures" ] && exit 0
large_file_block \
  "check:dup found a large file above its recorded ceiling, a large file that is not recorded, or one it could not measure." \
  "${failures%$'\n'}"
exit 2
