#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

out="$(osv-scanner scan source --lockfile="$ROOT/package-lock.json" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "osv-scanner (known vulnerabilities)" \
    "osv-scanner found a known vulnerability in a dependency." \
    "$out" \
    "A known CVE in a dependency is a concrete, exploitable risk, not a style nit. Shipping it knowingly is a supply-chain failure." \
    "Upgrade the affected package to a patched version. If none exists yet, document the risk and track it; do not ignore silently. Re-run: npm run check:deep" \
    "Do not suppress the finding without a tracked remediation plan. Upgrade or replace the vulnerable dependency."
  exit 2
fi
exit 0
