#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
# KIKO_RULES_FIXTURES is a test-only seam (__tests__/semgrep-rules-nested-fixtures.test.ts):
# it points the scan at a throwaway directory instead of the real, much
# larger rules/fixtures/ tree, so the nested-discovery mechanism below can be
# proven in isolation. Unset in production; every real invocation still
# scans $ROOT/rules/fixtures.
FIXTURES="${KIKO_RULES_FIXTURES:-$ROOT/rules/fixtures}"

# Proves each project Semgrep rule still fires, and still stays quiet, against
# its own fixture pair: a rule that silently stops matching reads as a passing
# check. Contract — `rules/fixtures/<rule-id>.bad.<ext>` must report at least
# one finding from that rule, `<rule-id>.good.<ext>` none from any rule, and a
# standalone `// EXPECT-FINDING` (or `#`) comment pins a finding to the next
# line. "Nothing was checked" fails the same way as a broken rule.
#
# A rule scoped by a path-prefixed `paths.include` (e.g.
# `src/monobank/**`) draws NOTHING against a fixture placed directly in
# rules/fixtures/ — kiko-linter's "Semgrep facts" gotcha — so that rule's
# fixture pair instead lives NESTED, at
# `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`, credited
# to the rule id named by the fixture's OWN first directory segment rather
# than by its filename. A flat, top-level fixture keeps working exactly as
# before.

fail_scanner() {
  # $1 what  $2 details
  print_block \
    "Semgrep rule fixtures" \
    "$1" \
    "$2" \
    "The fixture scan did not complete, so the project's own Semgrep rules were NOT proven to still fire. An unproven rule set must not report success — that is the exact failure this check exists to catch." \
    "Fix the error above, then re-run: npm run check:rules" \
    "Do not treat a broken, empty, or skipped scan as a pass. Fix it, then re-run."
  exit 2
}

if ! command -v semgrep >/dev/null 2>&1; then
  print_block \
    "Semgrep rule fixtures" \
    "The semgrep tool is not installed." \
    "'semgrep' was not found on PATH." \
    "Without semgrep the project's own rules cannot be proven to still work, and a missing tool must not look like a pass." \
    "Run: brew install semgrep   then re-run: npm run check:rules" \
    "Do not treat a missing scanner as a pass. Install semgrep, then re-run."
  exit 2
fi

if [ ! -d "$FIXTURES" ]; then
  fail_scanner \
    "The fixture directory does not exist." \
    "Expected a directory at: $FIXTURES"
fi

# Every rule is proven by a fixture pair, so no fixtures means nothing was
# proven. Recursive (a fixture may be nested — see above); dotfiles, which
# are never fixtures, are skipped by basename at any depth.
fixture_count=0
while IFS= read -r -d '' fixture; do
  fixture_count=$((fixture_count + 1))
done < <(find "$FIXTURES" -type f ! -name '.*' -print0)
if [ "$fixture_count" -eq 0 ]; then
  fail_scanner \
    "The fixture directory holds no fixture files." \
    "$FIXTURES contains no regular file (dotfiles do not count). Every rule in rules/semgrep-mobile.yml or rules/semgrep-prewrite.yml is supposed to have a <rule-id>.bad.<ext> / <rule-id>.good.<ext> pair here."
fi

stderr_file="$(mktemp -t kiko-rules-stderr)" || fail_scanner \
  "Could not create a temporary file for semgrep's stderr." \
  "mktemp failed."

out="$(semgrep --quiet --json \
  --config "$ROOT/rules/semgrep-mobile.yml" \
  --config "$ROOT/rules/semgrep-prewrite.yml" \
  "$FIXTURES" 2>"$stderr_file")"
semgrep_code=$?
stderr_out="$(cat "$stderr_file" 2>/dev/null)"
rm -f "$stderr_file"

# 0 = clean, 1 = findings (expected: the positive fixtures). Anything else is
# semgrep itself failing, which must not read as a pass.
if [ "$semgrep_code" -ne 0 ] && [ "$semgrep_code" -ne 1 ]; then
  fail_scanner \
    "Semgrep itself failed to run (exit $semgrep_code)." \
    "${stderr_out:-<no stderr>}"
fi

report="$(printf '%s' "$out" | FIXTURES="$FIXTURES" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const fs=require("fs"), path=require("path");
  const dir=process.env.FIXTURES;
  const toPosix=(p)=>p.split(path.sep).join("/");
  let j;
  try { j=JSON.parse(s); } catch {
    process.stdout.write("Semgrep did not return JSON:\n"+s);
    process.exitCode=1; return;
  }
  const results=j.results||[];
  // Both the scanned list and every result path are normalized to a POSIX
  // path RELATIVE to the fixtures dir, so a flat fixture (relative path with
  // no separator) and a NESTED one (relative path whose first segment is the
  // owning rule id) are matched the same way, whether semgrep reported an
  // absolute path or one relative to this process'\''s own cwd.
  const relativeTo = (p) => toPosix(path.relative(dir, path.resolve(p)));
  const scanned=new Set((((j.paths||{}).scanned)||[]).map(relativeTo));
  const walk=(base)=>{
    const out=[];
    for (const entry of fs.readdirSync(base,{recursive:true,withFileTypes:true})) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      out.push(toPosix(path.relative(base, path.join(entry.parentPath, entry.name))));
    }
    return out;
  };
  const files=walk(dir);
  const problems=[];
  if(!files.length) problems.push("the fixture directory holds no fixture files");
  for (const e of (j.errors||[]))
    problems.push(`semgrep reported an error: ${e.long_msg||e.message||JSON.stringify(e)}`);
  const resultsByRelativePath=new Map();
  for (const r of results) {
    const relative=relativeTo(r.path);
    if(!resultsByRelativePath.has(relative)) resultsByRelativePath.set(relative, []);
    resultsByRelativePath.get(relative).push(r);
  }
  // ruleId -> whether a positive/negative fixture was seen for it.
  const ruleFixtures=new Map();
  const noteFixture=(ruleId,kind)=>{
    const entry=ruleFixtures.get(ruleId)||{hasBad:false,hasGood:false};
    if(kind==="bad") entry.hasBad=true;
    if(kind==="good") entry.hasGood=true;
    ruleFixtures.set(ruleId,entry);
  };
  for (const relative of files) {
    if(!scanned.has(relative)) {
      problems.push(`fixture ${relative} was never scanned by semgrep (absent from paths.scanned), so the rule that owns it proved nothing`);
      continue;
    }
    const segments=relative.split("/");
    const basename=segments[segments.length-1];
    const nested=segments.length>1;
    const m=/^(.+)\.(bad|good)\.[^.]+$/.exec(basename);
    if(!m) { problems.push(`fixture "${relative}" does not follow <rule-id>.(bad|good).<ext>`); continue; }
    const kind=m[2];
    // A nested fixture is credited to its OWN first directory segment (the
    // rule id a paths.include-scoped rule needs a mirrored path for), never
    // to its basename'\''s own "name" part.
    const ruleId=nested?segments[0]:m[1];
    noteFixture(ruleId,kind);
    const hits=resultsByRelativePath.get(relative)||[];
    if(kind==="bad") {
      const mine=hits.filter(r=>r.check_id.slice(r.check_id.lastIndexOf(".")+1)===ruleId);
      if(!mine.length)
        problems.push(`rule "${ruleId}" reported NOTHING on its positive fixture ${relative}`);
      const lines=new Set(mine.map(r=>(r.start||{}).line));
      fs.readFileSync(path.join(dir,...segments),"utf8").split("\n").forEach((line,i)=>{
        if(!/^\s*(\/\/|#)\s*EXPECT-FINDING\s*$/.test(line)) return;
        const pinned=i+2;
        if(!lines.has(pinned))
          problems.push(`rule "${ruleId}" reported nothing at ${relative}:${pinned}, a line pinned by an EXPECT-FINDING comment`);
      });
    }
    if(kind==="good" && hits.length)
      problems.push(`negative fixture ${relative} matched: ${hits.map(r=>r.check_id).join(", ")}`);
  }
  for (const [ruleId,entry] of ruleFixtures) {
    if(!entry.hasBad) problems.push(`rule "${ruleId}" has no positive fixture`);
    if(!entry.hasGood) problems.push(`rule "${ruleId}" has no negative fixture`);
  }
  process.stdout.write(problems.join("\n"));
})')"
node_code=$?

if [ "$node_code" -ne 0 ]; then
  fail_scanner \
    "The fixture verifier could not read semgrep's output (node exit $node_code)." \
    "${report:-<no output>}
--- semgrep stderr ---
${stderr_out:-<no stderr>}"
fi

if [ -n "$report" ]; then
  print_block \
    "Semgrep rule fixtures" \
    "A project Semgrep rule no longer behaves as specified against its fixtures." \
    "$report" \
    "A rule that stopped matching still reports success, so the finding it was written for silently comes back. The fixture pair is the rule's own test." \
    "Fix the rule in rules/semgrep-mobile.yml or rules/semgrep-prewrite.yml until its positive fixture matches (including every EXPECT-FINDING line) and its negative fixture does not. Re-run: npm run check:rules" \
    "Do not delete or edit a fixture to make the check pass, and do not add nosemgrep. Fix the rule."
  exit 2
fi

exit 0
