#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

if ! command -v semgrep >/dev/null 2>&1; then
  print_block \
    "Semgrep (mobile security rules)" \
    "The semgrep tool is not installed." \
    "'semgrep' was not found on PATH." \
    "The harness tools must be present to run. Without semgrep, no security signal is available, and a missing tool must not look like a security problem." \
    "Run: brew install semgrep   then re-run: npm run check:security" \
    "Do not treat a missing scanner as a pass. Install semgrep, then re-run."
  exit 2
fi

# Every argument is a scan target (no argument means the whole repo), and all
# of them go to ONE Semgrep call; an empty-string argument is passed on, so
# Semgrep rejects it and the scan fails closed. `rules/fixtures/` holds the
# positive/negative fixture pair for each project rule. A positive fixture is
# deliberately vulnerable code, so it must not fail the real scan;
# `scripts/checks/semgrep-rules.sh` is what scans it on purpose.
# `--exclude 'fixtures'` below only prunes that directory while WALKING a
# tree — semgrep still scans a fixture file passed as a direct, single-file
# TARGET (the fast-tier hook's own shape), so such a target is dropped here
# explicitly instead. The drop is a prefix match, so a path with a `..` segment
# is never dropped: `rules/fixtures/../../src/x.ts` would otherwise leave
# `src/x.ts` unscanned.
TARGETS=()
for argument in "$@"; do
  case "$argument" in
    */../* | */..) TARGETS+=("$argument") ;;
    "$ROOT/rules/fixtures/"* | rules/fixtures/*) ;;
    *) TARGETS+=("$argument") ;;
  esac
done
if [ "$#" -eq 0 ]; then
  TARGETS=("$ROOT")
fi
if [ "${#TARGETS[@]}" -eq 0 ]; then
  exit 0
fi

# Dedup a call whose targets are all files on their content plus the mobile
# rules files; the key names every target, so a changed file or a different
# file set is never vouched for by an earlier pass. The external p/ rulesets
# are pinned to the installed semgrep and do not change within a session, so
# they are not part of the fingerprint. A whole-repo or directory target always
# runs. A skip says so on stderr: an exit 0 with no scan must not read as one.
dkey=""; fp=""
all_files=1
for target in "${TARGETS[@]}"; do
  [ -f "$target" ] || all_files=0
done
if [ "$all_files" -eq 1 ]; then
  dkey="security:$(printf '%s\n' "${TARGETS[@]}" | harness_hash)"
  fp="$( { shasum "${TARGETS[@]}" 2>/dev/null
          shasum "$ROOT/rules/semgrep-mobile.yml" 2>/dev/null
          shasum "$ROOT/rules/semgrep-prewrite.yml" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    printf 'security.sh: SKIPPED, not a fresh scan: %s target(s) are unchanged since their last passing scan (same file content, same rules files). Run npm run check:security with no argument for a full scan.\n' "${#TARGETS[@]}" >&2
    exit 0
  fi
fi

out="$(semgrep --quiet --error --json \
  --config p/typescript --config p/react --config p/secrets \
  --config "$ROOT/rules/semgrep-mobile.yml" \
  --config "$ROOT/rules/semgrep-prewrite.yml" \
  --exclude 'fixtures' \
  "${TARGETS[@]}" 2>/tmp/kiko-security-stderr.$$)"
semgrep_code=$?
stderr_out="$(cat /tmp/kiko-security-stderr.$$ 2>/dev/null)"
rm -f /tmp/kiko-security-stderr.$$

# What Semgrep says went wrong. --quiet keeps its log off stderr, so the reason
# lives in the JSON's errors[]: every entry for "any", only an "error"-level or
# Timeout entry for "blocking". Output that is not JSON cannot prove zero
# findings, so it is reported as a problem either way.
semgrep_error_text() {
  printf '%s' "$out" | node -e '
let text="";process.stdin.on("data",(chunk)=>text+=chunk).on("end",()=>{
  let parsed;
  try{parsed=JSON.parse(text)}
  catch{process.stdout.write("Semgrep output was not valid JSON"+(text.trim()===""?".":": "+text.trim().slice(0,500)));return}
  const entries=(parsed.errors||[]).filter((entry)=>process.argv[1]==="any"||entry.level==="error"||entry.type==="Timeout");
  process.stdout.write(entries.map((entry)=>entry.long_msg||entry.message||JSON.stringify(entry)).join("\n"));
})' "$1"
}

# The findings of one severity from the JSON already in hand, one block each:
# location and rule id, then the rule message. Reading the JSON (not running
# Semgrep a second time) means the block always names what the count counted.
semgrep_findings_text() {
  printf '%s' "$out" | node -e '
let text="";process.stdin.on("data",(chunk)=>text+=chunk).on("end",()=>{
  let blocks=[];
  try{
    blocks=(JSON.parse(text).results||[])
      .filter((entry)=>(entry.extra&&entry.extra.severity)===process.argv[1])
      .map((entry)=>entry.path+":"+(entry.start&&entry.start.line)+"  "+entry.check_id+"\n    "+((entry.extra&&entry.extra.message)||"").trim().replace(/\s+/g," "));
  }catch{}
  process.stdout.write(blocks.join("\n"));
})' "$1"
}

if [ "$semgrep_code" -ne 0 ] && [ "$semgrep_code" -ne 1 ]; then
  newline=$'\n'
  details="Semgrep exit $semgrep_code.${stderr_out:+$newline$stderr_out}$newline$(semgrep_error_text any)"
  print_block \
    "Semgrep (mobile security rules)" \
    "Semgrep itself failed to run (exit $semgrep_code)." \
    "$details" \
    "The security scan could not complete, so no security signal is available for this change." \
    "Fix the Semgrep invocation or configuration error above and re-run: npm run check:security" \
    "Do not treat a broken scan as a pass. Fix the scanner, then re-run."
  exit 2
fi

# A rule Semgrep could not evaluate is a rule that silently did not run on
# that file: a Timeout (reported only at level "warn", exit 0) or any
# "error"-level entry fails closed, the same as semgrep-rules.sh treats a
# Semgrep error as a failed proof. Unparseable output fails too, since it
# cannot prove zero findings. Other warn-level entries stay non-blocking.
scan_problems="$(semgrep_error_text blocking)"

if [ -n "$scan_problems" ]; then
  print_block \
    "Semgrep (mobile security rules)" \
    "Semgrep could not evaluate every rule on every file (a rule timed out or errored)." \
    "$scan_problems" \
    "A rule that timed out or errored did not run on that file, so a vulnerability there would pass unseen." \
    "Make the named rule cheaper on the named file (or fix the reported error) and re-run: npm run check:security" \
    "Do not raise the timeout or exclude the file to pass. Fix the rule or the scan error."
  exit 2
fi

# Class A (ERROR): hard-fail. Class B (WARNING): override-eligible,
# surfaced but does not block on its own.
error_count="$(printf '%s' "$out" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{
    const j=JSON.parse(s);
    const n=(j.results||[]).filter(r=>(r.extra&&r.extra.severity)==="ERROR").length;
    process.stdout.write(String(n));
  }catch{process.stdout.write("0")}
})')"
warning_count="$(printf '%s' "$out" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{
    const j=JSON.parse(s);
    const n=(j.results||[]).filter(r=>(r.extra&&r.extra.severity)==="WARNING").length;
    process.stdout.write(String(n));
  }catch{process.stdout.write("0")}
})')"

if [ "${error_count:-0}" -gt 0 ]; then
  readable="$(semgrep_findings_text ERROR)"
  print_block \
    "Semgrep (mobile security rules) — Class A hard-fail" \
    "Semgrep found $error_count Class A (ERROR) security finding(s)." \
    "$readable" \
    "These are deterministic, high-confidence mobile client vulnerabilities: disabled TLS validation, non-cryptographic randomness used for a token/secret, or a secret written to unencrypted AsyncStorage. Each is directly exploitable." \
    "Fix the vulnerability at its source. Re-run: npm run check:security" \
    "Do not add nosemgrep to pass. Fix the vulnerability; for a Class B finding, add an OVERRIDE(...) noting why it is safe."
  exit 2
fi

if [ "${warning_count:-0}" -gt 0 ]; then
  readable="$(semgrep_findings_text WARNING)"
  {
    printf '────────────────────────────────────────────────────────\n'
    printf 'ⓘ CLASS B FINDING (override-eligible): Semgrep (mobile security rules)\n'
    printf '────────────────────────────────────────────────────────\n'
    printf 'WHAT FAILED:    Semgrep found %s Class B (WARNING) security finding(s). This does not block.\n' "$warning_count"
    printf 'DETAILS:        %s\n' "$readable"
    printf 'WHY IT MATTERS: The pattern can be safe in context, but needs a human or agent to confirm that and record why.\n'
    printf 'HOW TO FIX:     Confirm the input is constant or fully sanitized, or add an OVERRIDE(...) with the specific reason it is safe.\n'
    printf 'DO NOT:         Do not add nosemgrep to pass. Fix the vulnerability; for a Class B finding, add an OVERRIDE(...) noting why it is safe.\n'
    printf '────────────────────────────────────────────────────────\n'
  } >&2
fi

# No Class A finding: record the pass so an unchanged file set skips next time.
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
exit 0
