#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
TARGET="${1:-$ROOT}"

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

out="$(semgrep --quiet --error --json \
  --config p/typescript --config p/react --config p/secrets \
  --config "$ROOT/rules/semgrep-mobile.yml" \
  "$TARGET" 2>/tmp/pff-security-stderr.$$)"
semgrep_code=$?
stderr_out="$(cat /tmp/pff-security-stderr.$$ 2>/dev/null)"
rm -f /tmp/pff-security-stderr.$$

if [ "$semgrep_code" -ne 0 ] && [ "$semgrep_code" -ne 1 ]; then
  print_block \
    "Semgrep (mobile security rules)" \
    "Semgrep itself failed to run (exit $semgrep_code)." \
    "$stderr_out" \
    "The security scan could not complete, so no security signal is available for this change." \
    "Fix the Semgrep invocation or configuration error above and re-run: npm run check:security" \
    "Do not treat a broken scan as a pass. Fix the scanner, then re-run."
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
  readable="$(semgrep --quiet \
    --config p/typescript --config p/react --config p/secrets \
    --config "$ROOT/rules/semgrep-mobile.yml" \
    "$TARGET" 2>&1)"
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
  readable="$(semgrep --quiet \
    --config p/typescript --config p/react --config p/secrets \
    --config "$ROOT/rules/semgrep-mobile.yml" \
    "$TARGET" 2>&1)"
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

exit 0
