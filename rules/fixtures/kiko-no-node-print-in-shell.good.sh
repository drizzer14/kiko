#!/usr/bin/env bash
set -uo pipefail

# process.stdout.write is not colored by FORCE_COLOR, so the value stays a bare number.
threshold="$(node -e "process.stdout.write(String(require('./.jscpd.json').threshold))")"

stamp="$(node -e 'process.stdout.write(String(Date.now()))')"

# A script file takes its arguments without --print.
count="$(node scripts/count.js --prefix 1)"

# An option that merely starts with a p is not --print.
node --preserve-symlinks scripts/run.js
