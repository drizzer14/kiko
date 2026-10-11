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
paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(".")

# A path that is not on disk (a deleted file) makes jscpd exit non-zero with ENOENT, which
# the blocking run below would report as duplication. Say what is wrong instead.
for p in "$@"; do
  if [ ! -e "$p" ]; then
    print_block \
      "jscpd (copy/paste detection)" \
      "A path passed to check:dup does not exist, so jscpd was not run." \
      "Missing path: $p" \
      "jscpd cannot read a file that is not on disk. A missing file is not duplicated code, and passing it on would report a false duplication failure." \
      "Drop the path from the arguments (a deleted file has nothing to measure). Re-run: npm run check:dup" \
      "Do not create an empty file at the path to get past this."
    exit 2
  fi
done

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

# Second, NON-blocking pass. jscpd skips a file over maxLines (1000) or maxSize (100kb) without a
# word, so the blocking run above never measured those files. Its file selection (the config's
# ignore list, .gitignore, the format filter) is the only thing that knows which files are in
# scope, so ask it: `--debug` lists the selected files and runs no detection. The files in the
# list made with the limits raised but not in the default list are exactly the ones the blocking
# run skipped for size. Each is measured ALONE with the limits raised, because a run of the whole
# set attributes a clone to whichever file jscpd stores first, which makes a file's percentage
# depend on its neighbours. A clone between a large file and ANOTHER file is invisible alone, so
# one more run measures the whole scope together with the limits raised; it needs two files to
# find such a clone, so a scope with one file skips it (it would repeat the alone figure). Over the
# threshold is a WARNING on stderr and the exit code stays 0: the sweep of those files is tracked
# debt (docs/harness/documented-exceptions.md), and it flips this pass to a failure.
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

# A failure to LIST warns and never silences: the blocking pass already failed closed on a real
# jscpd crash, but the large files must not go unmeasured without a trace.
if ! default_list="$(listed_files)" || ! raised_list="$(listed_files "${RAISED_LIMITS[@]}")"; then
  printf 'WARNING: check:dup could not list the files it skipped for size: jscpd --debug failed.\n' >&2
  exit 0
fi
skipped="$(LC_ALL=C comm -13 <(printf '%s\n' "$default_list") <(printf '%s\n' "$raised_list"))"
[ -z "$skipped" ] && exit 0

# process.stdout.write keeps a number bare under FORCE_COLOR, which the print flag of node does
# not (kiko-linter "Never use the print flag of node in a shell script").
threshold="$(node -e 'process.stdout.write(String(require(process.argv[1]).threshold))' "$ROOT/.jscpd.json" 2>/dev/null)"
is_number "$threshold" || threshold=5
report_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-dup-large.XXXXXX")" || {
  printf 'WARNING: check:dup could not measure the files it skipped for size: mktemp failed.\n' >&2
  exit 0
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

# over_threshold <percentage> : succeeds when the figure is over the threshold.
over_threshold() {
  awk -v p="$1" -v t="$threshold" 'BEGIN { exit !(p > t) }'
}

# measure_one <number> <file> : writes the file's WARNING line, if any, to
# "$report_dir/<number>.warning".
measure_one() {
  local number="$1" file="$2" shown measured status
  shown="${file#"$ROOT"/}"
  shown="${shown#"$root_real"/}"
  measured="$(measure "$number" "$file")"
  status=$?
  if [ "$status" -eq 1 ]; then
    printf 'WARNING: check:dup could not measure %s: jscpd failed on it.\n' "$shown" > "$report_dir/$number.warning"
  elif [ "$status" -ne 0 ]; then
    printf 'WARNING: check:dup could not measure %s: jscpd produced no figure for it.\n' "$shown" > "$report_dir/$number.warning"
  elif over_threshold "$measured"; then
    printf 'WARNING: check:dup %s is over jscpd'\''s size limit (1000 lines or 100kb), so the blocking run skipped it; measured alone it is %s%% duplicated (threshold %s%%). See the tracked-debt list in docs/harness/documented-exceptions.md; a file not on it is a new regression.\n' \
      "$shown" "$measured" "$threshold" > "$report_dir/$number.warning"
  fi
}

# measure_combined : the whole scope together, writing its WARNING line, if any, to
# "$report_dir/combined.warning".
measure_combined() {
  local measured status
  measured="$(measure combined "${paths[@]}")"
  status=$?
  if [ "$status" -ne 0 ]; then
    printf 'WARNING: check:dup could not measure the combined run (every file in scope, size limits raised).\n' > "$report_dir/combined.warning"
  elif over_threshold "$measured"; then
    printf 'WARNING: check:dup combined run (every file in scope, size limits raised) is %s%% duplicated (threshold %s%%); a clone between a large file and another file counts only here. See the tracked-debt list in docs/harness/documented-exceptions.md; the recorded baseline there applies to the no-argument (whole-repo) run only, and a whole-repo figure above it is a new regression.\n' \
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
for ((i = 1; i <= n; i++)); do
  [ -f "$report_dir/$i.warning" ] && cat "$report_dir/$i.warning" >&2
done
[ -f "$report_dir/combined.warning" ] && cat "$report_dir/combined.warning" >&2
exit 0
