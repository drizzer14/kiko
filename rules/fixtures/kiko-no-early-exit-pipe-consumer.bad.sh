#!/usr/bin/env bash
set -uo pipefail

# EXPECT-FINDING
if printf '%s\n' "$out" | grep -q 'did not result in any files'; then :; fi

# EXPECT-FINDING
if ! echo "$out" | grep -qF '/* InfoPlist.strings in Resources */'; then :; fi

# EXPECT-FINDING
if printf '%s\n' "$pinned" | grep -Fxq "$host"; then :; fi

# EXPECT-FINDING
if echo "$out" | grep --quiet 'pattern'; then :; fi

# EXPECT-FINDING
if echo "$out" | grep -m1 'pattern'; then :; fi

# EXPECT-FINDING
if echo "$out" | grep -m 1 'pattern'; then :; fi

# EXPECT-FINDING
if echo "$out" | grep -E -q 'pattern'; then :; fi

# A producer that is not a printf or an echo races the same way.
# EXPECT-FINDING
if git diff --name-only HEAD | grep -q 'package.json'; then :; fi

# A pipe continued on the next line is the same pipeline.
# EXPECT-FINDING
printf '%s\n' "$out" |
  grep -q 'pattern'

# EXPECT-FINDING
first="$(grep -E "^${name}=" .env | head -1 | cut -d= -f2-)"

# EXPECT-FINDING
latest="$(git log --oneline | head -n 1)"
