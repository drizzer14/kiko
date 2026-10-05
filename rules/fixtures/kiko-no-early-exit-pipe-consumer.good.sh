#!/usr/bin/env bash
set -uo pipefail

# A here-string reads the whole value without a producer to kill.
if grep -q 'did not result in any files' <<<"$out"; then :; fi

if ! grep -qF '/* InfoPlist.strings in Resources */' <<<"$out"; then :; fi

if grep -Fxq "$host" <<<"$pinned"; then :; fi

# A case match needs no pipe at all.
case "$out" in
  *'did not result in any files'*) : ;;
esac

# A file argument has no producer.
if grep -q 'pattern' file.txt; then :; fi

# A command's own output is captured first, then matched.
changed="$(git diff --name-only HEAD)"
if grep -q 'package.json' <<<"$changed"; then :; fi

# A pipe into a grep that reads to the end of its input does not race.
printf '%s\n' "$out" | grep -E 'pattern'
printf '%s\n' "$out" | grep -c 'pattern'
printf '%s\n' "$out" | grep -v 'pattern' | sort
printf '%s\n' "$out" | grep -Eo '[0-9]+' | tail -1

# sed reads to the end of its input, so a first line taken with it does not race.
first="$(grep -E "^${name}=" .env | sed -n '1p' | cut -d= -f2-)"
