#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
payload="$(cat)"
file="$(printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{process.stdout.write("")}})')"
[ -z "$file" ] && exit 0
case "$file" in
  *.ts|*.tsx|*.js) : ;;
  *) exit 0 ;;
esac
"$DIR/lint.sh" "$file" || exit 2
"$DIR/security.sh" "$file" || exit 2
"$DIR/secrets.sh" "$file" || exit 2
exit 0
