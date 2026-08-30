#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/dup.sh" || exit 2
"$DIR/knip.sh" || exit 2
"$DIR/deps.sh" || exit 2
"$DIR/override-guard.sh" || exit 2
exit 0
