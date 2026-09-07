#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
TARGET="${1:-$ROOT}"

if ! command -v gitleaks >/dev/null 2>&1; then
  print_block \
    "gitleaks (secret scanning)" \
    "The gitleaks tool is not installed." \
    "'gitleaks' was not found on PATH." \
    "The harness tools must be present to run. Without gitleaks, no secret-scanning signal is available, and a missing tool must not look like a leaked secret." \
    "Run: brew install gitleaks   then re-run: npm run check:secrets" \
    "Do not treat a missing scanner as a pass. Install gitleaks, then re-run."
  exit 2
fi

# Dedup a single-file target on its content plus the gitleaks config. A
# whole-repo or directory target always runs.
dkey=""; fp=""
if [ -f "$TARGET" ]; then
  dkey="secrets:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$ROOT/.gitleaks.toml" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi
fi

out="$(gitleaks detect --no-git --source "$TARGET" --config "$ROOT/.gitleaks.toml" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "gitleaks (secret scanning)" \
    "gitleaks found a hardcoded secret in $TARGET." \
    "$out" \
    "A committed secret (API key, token, credential) is immediately compromised: it is visible to anyone with repo access and in git history forever. This is a common LLM failure mode: inlining a real-looking credential instead of loading it at runtime." \
    "Remove the secret and load it from the iOS Keychain or an environment variable at runtime. Rotate the credential if it was ever real. Re-run: npm run check:secrets" \
    "Do not move the secret to a config file. Remove it and load it from the iOS Keychain or an env var at runtime."
  exit 2
fi
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
exit 0
