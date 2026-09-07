#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
FIXTURES="$ROOT/rules/fixtures"

# Proves each project Semgrep rule still fires, and still stays quiet, against
# its own fixture pair: a rule that silently stops matching reads as a passing
# check. Contract — `rules/fixtures/<rule-id>.bad.<ext>` must report at least
# one finding from that rule, `<rule-id>.good.<ext>` none from any rule, and a
# standalone `// EXPECT-FINDING` (or `#`) comment pins a finding to the next
# line. "Nothing was checked" fails the same way as a broken rule.

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
# proven. The glob skips dotfiles, which are never fixtures.
fixture_count=0
for fixture in "$FIXTURES"/*; do
  [ -f "$fixture" ] || continue
  fixture_count=$((fixture_count + 1))
done
if [ "$fixture_count" -eq 0 ]; then
  fail_scanner \
    "The fixture directory holds no fixture files." \
    "$FIXTURES contains no regular file (dotfiles do not count). Every rule in rules/semgrep-mobile.yml is supposed to have a <rule-id>.bad.<ext> / <rule-id>.good.<ext> pair here."
fi

stderr_file="$(mktemp -t kiko-rules-stderr)" || fail_scanner \
  "Could not create a temporary file for semgrep's stderr." \
  "mktemp failed."

out="$(semgrep --quiet --json --config "$ROOT/rules/semgrep-mobile.yml" "$FIXTURES" 2>"$stderr_file")"
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
  let j;
  try { j=JSON.parse(s); } catch {
    process.stdout.write("Semgrep did not return JSON:\n"+s);
    process.exitCode=1; return;
  }
  const results=j.results||[];
  const scanned=new Set((((j.paths||{}).scanned)||[]).map(p=>path.basename(p)));
  const files=fs.readdirSync(dir).filter(f=>!f.startsWith("."));
  const problems=[];
  if(!files.length) problems.push("the fixture directory holds no fixture files");
  for (const e of (j.errors||[]))
    problems.push(`semgrep reported an error: ${e.long_msg||e.message||JSON.stringify(e)}`);
  for (const f of files) {
    if(!scanned.has(f)) {
      problems.push(`fixture ${f} was never scanned by semgrep (absent from paths.scanned), so the rule that owns it proved nothing`);
      continue;
    }
    const m=/^(.+)\.(bad|good)\.[^.]+$/.exec(f);
    if(!m) { problems.push(`fixture "${f}" does not follow <rule-id>.(bad|good).<ext>`); continue; }
    const [,ruleId,kind]=m;
    const hits=results.filter(r=>path.basename(r.path)===f);
    if(kind==="bad") {
      const mine=hits.filter(r=>r.check_id.slice(r.check_id.lastIndexOf(".")+1)===ruleId);
      if(!mine.length)
        problems.push(`rule "${ruleId}" reported NOTHING on its positive fixture ${f}`);
      const lines=new Set(mine.map(r=>(r.start||{}).line));
      fs.readFileSync(path.join(dir,f),"utf8").split("\n").forEach((line,i)=>{
        if(!/^\s*(\/\/|#)\s*EXPECT-FINDING\s*$/.test(line)) return;
        const pinned=i+2;
        if(!lines.has(pinned))
          problems.push(`rule "${ruleId}" reported nothing at ${f}:${pinned}, a line pinned by an EXPECT-FINDING comment`);
      });
    }
    if(kind==="good" && hits.length)
      problems.push(`negative fixture ${f} matched: ${hits.map(r=>r.check_id).join(", ")}`);
  }
  const ids=new Set(files.map(f=>(/^(.+)\.(bad|good)\./.exec(f)||[])[1]).filter(Boolean));
  for (const id of ids) {
    if(!files.some(f=>f.startsWith(id+".bad."))) problems.push(`rule "${id}" has no positive fixture`);
    if(!files.some(f=>f.startsWith(id+".good."))) problems.push(`rule "${id}" has no negative fixture`);
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
    "Fix the rule in rules/semgrep-mobile.yml until its positive fixture matches (including every EXPECT-FINDING line) and its negative fixture does not. Re-run: npm run check:rules" \
    "Do not delete or edit a fixture to make the check pass, and do not add nosemgrep. Fix the rule."
  exit 2
fi

exit 0
