#!/usr/bin/env bash
set -uo pipefail

# EXPECT-FINDING
threshold="$(node -p "require('./.jscpd.json').threshold" 2>/dev/null)"

# EXPECT-FINDING
stamp="$(node --print 'Date.now()')"

# EXPECT-FINDING
percentage="$(node -pe 'JSON.parse(process.argv[1]).percentage' "$report")"

# EXPECT-FINDING
count=$(node -p '1 + 1')

# EXPECT-FINDING
quoted="$(node -p"1 + 1")"

# EXPECT-FINDING
warned="$(node --no-warnings -p 'Date.now()')"

# EXPECT-FINDING
chained="$(node --no-warnings --preserve-symlinks --print 'Date.now()')"
