## F4 code-style mechanization candidates — all four now implemented

The nullable-ternary rule is `kiko-no-nullable-map-ternary` (Semgrep
ERROR, `rules/semgrep-prewrite.yml`) — see "Semgrep pattern strings need
quoting" below for the one gotcha that cost the most time writing it.
The one-exported-component-per-`.tsx` check is a Jest invariant plus a
pre-write guard Node rule, not Semgrep — see "One exported component per
`.tsx` — a Jest invariant and a guard rule" in rules-code.md. The import-length-sort check is a
hand-rolled
shell+JS checker/fixer at the fast tier — see "Import length-sort — a
hand-rolled checker (and fixer)" in rules-code.md. The comment checks are the comment-history
rules (`kiko-no-history-*`, `kiko-no-task-id-comment`) in `rules/semgrep-prewrite.yml` and
`rules/semgrep-mobile.yml` (the `*-shell-comment` rules); read both files for the set. See each
rule's section below; each rule's own `severity:` field is the source for its tier.

**Scope of the comment-history rules.** The id, word and date rules read TypeScript and
JavaScript, now including `__tests__/` and the scripts js; their `paths.exclude` keeps `e2e/`,
`harness/`, `App.tsx` and `drizzle.config.ts` out. Three generic shell rules in
`rules/semgrep-mobile.yml` (`kiko-no-history-id-shell-comment`,
`kiko-no-history-word-shell-comment`, `kiko-no-history-date-shell-comment`) apply the same
words, ids and dates to a line of a `.sh`, `.bash` or `githooks/` file whose first non-blank
character is `#`; a `#`
after code is not read. They are in
`semgrep-mobile.yml`, not `semgrep-prewrite.yml`, because the pre-write guard reads TypeScript
only; `check:security` and `check:rules` run them (fixtures
`rules/fixtures/kiko-no-history-*-shell-comment.{bad,good}.sh`). The id arm matches `U0` in a
comment that writes the git flag `-U0`: write `--unified=0` instead.
Known limit: the fast shell arm's Semgrep `githooks/*` path include matches relative to the
hook's cwd, so a githooks file edited from a session whose cwd is not at or above it (for
example a main-rooted session editing an Orca worktree's githooks file) gets no per-write
history-rule finding; `*.sh`/`*.bash` match from any cwd; project-wide `check:security` still
catches it.

## `kiko-no-stale-guideline-2-3-1a-citation`

The rule (`rules/semgrep-mobile.yml`, Class A ERROR) is a generic `pattern-regex`; its
`paths.include` (`src/**`, `e2e/**`, `.maestro/**`) keeps it off docs and skills. It flags
`2.3.1(a)` unless one of three adjacent forms sits on the citation itself:
"2.3.1(a) remediation", "formerly 2.3.1(a)" or "2.3.1(a), now 2.5.19". No date is required.
A marker wrapped onto the next line IS flagged, by design: keep the marker beside the citation.
A capitalised "Formerly 2.3.1(a)" is flagged too (the lookbehind is case-sensitive; use the
lowercase form). Real misses: the number split across lines (`2.3.1` then `(a)`), and the forms
`2.3.1 (a)` and `2.3.1a`. Coverage limits: `scripts/checks/security.sh` passes
`--exclude 'fixtures'`, which drops every path segment named fixtures, so project-wide
`check:security` never scans `e2e/screenshot/fixtures/**`. The fast tier runs the rule on
`.ts`, `.tsx`, `.js`, `.yml` and `.yaml` writes but skips `.md`
(`scripts/checks/fast.sh`), so `e2e/screenshot/fixtures/README.md` is scanned by no tier.

## `kiko-no-history-id-comment`

Mechanizes kiko-code-style's "Comments: WHY only, never history": no
task id, review-round id, spec/decision id, or plan citation left
behind in a comment under `src`, `__tests__`, the scripts js, or a `#` line of a `.sh`, `.bash`
or `githooks/` file (read each rule's `paths` key). The member list is the two
`pattern-regex` arms of `kiko-no-history-id-comment` in
`rules/semgrep-prewrite.yml`. Read them for the current set; the P-ids are `P-?\d{1,3}`
(`P3`, `P-12`), and "Display P3" and the curve names P-256, P-384 and P-521 are
standards, not ids, so they stay silent (`rules/fixtures/kiko-no-history-id-comment.good.ts`).
A single-letter id whose hyphen has no word character before it (a git flag such as `-U0` or
`-M3`) is skipped; `review-M3` and `Step-T12` still fire.
The fixture pair shows each member. Two
`pattern-regex` arms, one per comment syntax —
a single regex spanning both `//` and `/* */` would have to
special-case where a line comment ends and a block comment does not.
The block-comment arm's `(?:(?!\*/)[\s\S])*?` (not a bare `[\s\S]*?`)
keeps a match from crossing a real `*/` into a LATER, unrelated block
comment.

Both arms are additionally anchored at line start with
`^(?:[^'"`\n]|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)*` — a char-by-char walk
that treats any COMPLETE same-line quoted string as one atomic skip,
so a `//` or `/*` that only appears INSIDE a string literal (a glob
like `'src/**/*.ts'`, a MIME wildcard `'*/*'`, a note like `'foo //
T12'`) never opens a match — only a real `//`/`/*` reached after
skipping every complete string earlier on that line can.

**Scope: `paths.exclude`, not `paths.include: ["src/**"]`.** A
path-prefixed `paths.include` would silently draw ZERO findings when
`semgrep-rules.sh` scans `rules/fixtures/` directly for this rule's
own positive fixture — the exact `paths.include` gotcha documented
above (a fixture isn't under a `src/**`-prefixed include, so it fails
CLOSED, invisibly). `paths.exclude` has no such failure mode (see
"Semgrep facts verified on 1.175" in semgrep-facts.md), so the rule instead excludes
`__tests__/**`, `e2e/**`, `scripts/**`, and `harness/**` (harness/test
tooling, not shipped app comments — some of these are covered by their
own dedicated harness checks instead), plus the two root files
`App.tsx` and `drizzle.config.ts` individually (root-level files
outside any `src/**`-style prefix an include could have named).
`__mocks__/**` is NOT excluded — a test mock's comments are exactly
the kind of file this rule should hold to the same standard as any
other, and excluding it would hide real hits.

`\b` word boundaries alone clear most of the false-positive shapes a
real sweep found, with no extra tuning needed: `i18n`/`ISIN`/`UTF-8`/
`ISO 4217` (the denylisted letter has no boundary before the digits
that follow it), an ISO instant's `T` glued directly to the date
before it (no boundary before the `T`), a hex color (the run of hex
digits never lands a boundary at exactly one denylisted letter), and a
denylisted letter+digit glued inside a larger camelCase domain word
like `computeD1Delta` (no boundary on either side) — see
`rules/fixtures/kiko-no-history-id-comment.good.ts` for a worked
example of each. The line-comment arm also excludes a `:` immediately
before the `//` (`(?<!:)`) — without it, the `//` inside an
`http://`/`https://` URL string literal (not a comment at all) reads
as a comment opener too.

**A new check lands together with the fix of its own existing
violations** — an ERROR rule alone, with no fix, would break the gate
on landing. This one **shipped WARNING first**: a real domain word CAN
still collide with the id shape as its OWN standalone token, not
merely a substring — no regex fix closes that gap the way the
boundary tricks above do (a short account-position label like a bare
`D2` in a list is syntactically identical to a real decision id). A
repo-wide sweep (every id-family hit, every `.superpowers/` path
citation, and every `round-N`/`device[- ]feedback`/`on-device review`
history-word cousin the id regex family covers) fixed that residual
class by rewording the handful of real collisions rather than
loosening the rule, and the rule is now **ERROR**: `semgrep --config
rules/semgrep-prewrite.yml src` reports 0 findings for it (run it as
`semgrep --metrics off --quiet --config rules/semgrep-prewrite.yml src`).

The same standalone-token collision applies to the `R\d`/`F\d`/`G\d`/
`C\d` families (added for review-round/audit ids like `R2-1`, `F3`,
`G2`, `C1`): a genuine prose sentence that happens to name "room R2"
or "gate G1" as its OWN standalone token is syntactically identical to
a real id and is accepted, not narrowed, the same way `D2` is above
— there is no regex that tells "room R2" apart from a real review id
without reading the surrounding English. `round-N` DOESN'T have this
problem: the digit is part of the id shape itself (`round-3`), so
ordinary prose that says "a round trip" (no hyphenated digit) never
matches at all — see `rules/fixtures/kiko-no-history-id-comment.good.ts`.

**A hyphenated debugger/verifier-report family**
(`(?:SYNC|INT|TWIN|TX|HOLD|BAK|STAT|AUTH|PERF|SEC|DEP|DEPS|CS)-\d+`,
2026-09-28) catches a debugger or verifier report's own finding id
(`SYNC-1`, `INT-1`, `TWIN-4`, `DEPS-3`, …) left behind in a comment —
the multi-round bug-hunt process names findings this way in its own
`.superpowers/sdd/` raw reports, and a fix comment citing that id
verbatim is exactly the "history, not WHY" shape this rule bans. Every
prefix here is at least two letters, so an ordinary sentence gluing
"SYNC"/"DEPS"/"TWIN" directly to a hyphen and digits by coincidence is
rare — but NOT impossible: the family originally also listed a bare
`V`, which collided with a real "V-8" reference and was dropped before
shipping (a single-letter member needs the same standalone-token
carve-out the `R\d`/`F\d`/`G\d`/`C\d` families above already carry, and
this family's whole point was to avoid that class of member). A
repo-wide sweep found zero remaining collisions before this family
shipped as ERROR directly (no WARNING-first rollout was needed, unlike
the original id families above) — see the fixture pair's own entries
(`SYNC-1`, `DEPS-3` positive; a lowercase/unhyphenated `sync`/`int`
negative probe, plus a `UTF-8`/`SHA-256`/`ISO-8601`/`Windows-1251`
regression lock against real WORD-digit technical vocabulary) for the
worked example.

**Hyphenated single-letter ids and `NEW-N` (2026-09-29).** The
single-letter families take an optional hyphen (`T-?\d{1,3}`), so a
`T-32`, `C-1`, or `M-3` id is caught like `T32`, and the hyphenated
report family gained `NEW` (`NEW-1`). `D` is the one letter WITHOUT the
hyphen: "day D-1" is the day before the purchase day D in the
net-worth and holding-value tests, a real domain token. The leading
`\b` still keeps `UTF-8`/`UTC-1`/`GMT-5` silent (no boundary before the
letter), and a `T-shirt`/`U-turn` has no digit after the hyphen.
`NEW-\d+` needs the hyphen right after `NEW`, so `NEWS-1` does not
match. Fixture pair: the four hyphen pins at the end of `.bad.ts`
and item 19 in `.good.ts`.

**Spec ruling, review-question and spec clause ids.** `S\d{1,3}-Q\d{1,3}` (`S12-Q34`),
`FQ\d{1,3}` (`FQ9`) and `C-NR-?[A-Z0-9]+` (`C-NR-E`, `C-NR3`) name a ruling or a spec clause of the
SDD process; a comment or a test title under `src` states the reason and the behaviour instead. The
same three members sit in `kiko-no-history-id-shell-comment`. The leading `\b` keeps `AS12-Q3` and
`FQDN` silent, and each member needs its digit or clause letter, so a bare `S12`, `Q3` or `C-NR`
stays prose. Fixtures: the last pins of `.bad.ts`/`.bad.sh` and the last probes of
`.good.ts`/`.good.sh`.

**`Phase N` is not a family member at all** — a bare `Phase\s\d+`
collides with ordinary engineering prose no digit-anchoring can fix
("Phase 1 copies the rows; Phase 2 deletes the source only after
commit" is ordinary prose that collides with the digit-anchored
pattern, not a review-round id). A "Phase N (Task M)" citation is
still caught without it: the existing `Task\s\d+` family member fires
on the "Task M" half of that exact shape, which is the only pattern
this codebase's real "Phase N" citations ever actually needed — see
the `.bad.ts`/`.good.ts` fixture pair for both the still-caught shape
and the prose the narrowing excludes.

**`the brief` is narrowed to `(?:task|parity)\sbrief(?:'s)?`** — the
bare word "brief" collides with ordinary English on its own ("brief"
as an adjective: "a brief window", "a brief moment"), which no
boundary trick fixes either. Requiring the specific "task"/"parity"
qualifier this codebase's own SDD vocabulary uses keeps every real
citation (`the parity brief's own signature`, `the task brief's
base64-decode ruling`) while a "brief window"-style sentence never
opens a match at all — see the fixture pair's `task brief`/`parity
brief` positive shapes and the `brief window` negative probe.

**A second, narrower member catches the same vocabulary without a
"task"/"parity" qualifier: `per\sthe\sbrief|the\sbrief's`.** A residual
gap left a bare "per the brief" or "the brief's own …" citation
uncaught, since neither has a "task"/"parity" qualifier before
"brief" for the member above to match. This member is deliberately
narrower than the bare word "brief" itself — it only fires on the
literal "per the" lead-in or a possessive "'s" directly after
"brief" — so it still never opens a match on "the brief window" (no
possessive, no "per the" lead-in) or "a brief native spinner" (plain
adjective use, no "the"/"per the" at all). Fixture pair: the `.bad.ts`
positive shapes ("per the brief, …", "the brief's residual gap …")
and the `.good.ts` negative probe covering both adjective shapes.

**The plan-history members (2026-09-29) need a citation shape, never a
bare `the plan` or `plan`.** `the plan` is domain prose in this codebase:
the rezone import computes and loads a plan (`rezone-import-times.ts`:
"Compute the plan (pure).", "Load the plan"), and the reminders planner
builds one (`sync-reminders.ts`: "the plan stops keeping its slot
free"). So each member requires a shape only a citation takes: a
numbered decision (`decision 18`, `Decision 6:`), a possessive (`the
plan's disposition`), a `doc` suffix (`plan doc`), or a `per`/`by`
lead-in (`per the plan`, `by the plan`). A bare `decision` (no digit)
stays silent too ("a decision the user makes"). The group's trailing
`\b` keeps a bare `commit` member from matching `commits` ("each batch
commits in one transaction"); only `[Ss]eparate\scommits?` takes the
plural, because "separate commits" is a citation and "separate" never
leads a database sentence. `in this plan`, `this plan also`, and a
dated plan name (`\d{4}-\d{2}-\d{2}\s[\w-]+\splan`, "(2026-09-11
multi-account plan)") are citation shapes too: the rezone and
reminders code says "the plan" or "this planner", never "in this plan".
Fixture pair: the plan-history pins in `.bad.ts` and items 16 and 18 in
`.good.ts`.

**The section members (2026-09-29) need a number.** The arm
`[Ss]ection\s(?:[A-Z0-9]+\.\d+|\d+)` fires on a word "section" followed by a dotted number
or by a bare number (`Section 4`). Its false-positive class is prose such as
`// section 3 of the form` and a number that is not a section id (`Section 508`); the tree
holds 0 such hits today. A
"Section" header row, "2 sections", and "subsection 2.1" (no word
boundary before "section") stay silent. `§\s?\d` sits OUTSIDE the `\b(...)`
group in both arms: `§` is not a word character, so a `\b` before it
would need a letter or digit right before the sign and miss "(§2.1)".
The optional space also catches a spaced "(§ 3)". An
external standard's section (`RFC 4231 §4.3`) is the same
standalone-token class as `D2` above: accepted, not narrowed. Cite the
test case or the heading instead ("RFC 4231 test case 2"). Fixture
pair: the five section pins at the end of `.bad.ts` and item 17 in
`.good.ts`.

**`next commit` can collide with database prose.** `commit` is also a
SQL transaction commit, so a real sentence like "the next commit
flushes the batch" is syntactically identical to a "lands in the next
commit" citation. It is the same standalone-token class as `D2` above:
accepted, not narrowed. The src tree has 0 such sentences today; if
one appears, reword it ("the following transaction commit"). The same
holds for `the plan's` in the reminders planner: write "the plan keeps
its slot", never "the plan's slot". `by the plan` and `per the plan` are
the same class: "the slot chosen by the plan" or "decided by the plan
owner" in rezone or reminders prose is syntactically a citation. The
src tree has 0 such sentences today; if one appears, reword it ("the
slot the plan chose").

**The user-request members (2026-09-30) need a date or a
sentence-opening past tense.** "user request" and "user feedback" are
domain prose too (a request to the server, feedback shown as a toast),
and "the user asked for" can describe runtime state ("retry only if the
user asked for one"). So there are two members, each the narrowest
shape the real hits took:
`user\s+(?:(?://|\*(?!/))\s*)?(?:request|feedback)\s+(?:(?://|\*(?!/))\s*)?\d{4}-\d{2}-\d{2}`
("(user request 2026-09-30)") needs an ISO date right after the words,
and `(?<=//\s|[.;:]\s|\*\s)[Tt]he\s+user\s+asked\s+for` needs "the user
asked for" to open a comment or a sentence. The optional `//` or `*`
between the words lets a member span a comment line break ("(user" at a
line end, "// feedback 2026-09-30)" on the next line); a bare `\s+`
cannot, because the next line's `//` is not whitespace. A comment or a
sentence that opens with a runtime "The user asked for a refresh, so …"
is the same standalone-token class as `D2` above: accepted, not
narrowed. Write "When the user asks for a refresh, …" instead. Fixture
pair: the six user-request pins at the end of `.bad.ts` and item 20 in
`.good.ts`.

**The branch, task, option, plan, and review-date members (2026-09-30).**
Six more citation shapes, each in both arms: `on\sthis\sbranch`,
`this\stask's`, `Option\s[A-Z]`, `for\sthis\splan`, `this\splan's`, and
`review,\s<ISO date>` ("(review, 2026-09-14)"). Each needs its whole shape:
"optional", "the Options list", a lowercase "option A/B toggle", "a branch
on this path", "the plan keeps its slot", and "review the rows, then retry"
stay silent. `Option\s[A-Z]` is the same standalone-token class as `D2`
above: a real UI option named by a capital letter ("Option B in the
picker") is syntactically identical to a design-option citation, and is
accepted, not narrowed. Name the option by what it does instead.
`on\sthis\sbranch` is the same class: "on this branch" also names a code
branch ("`value` is null on this branch" of an `if`), which is accepted,
not narrowed. Write "in this case" or "here" for a code branch. The
sweep that landed these members found 39 hits in 26 files; each was
reworded to keep the WHY, and a design option became the name of its
model ("the reflow error model", "connect-first"), never a blank.
Fixture pair: the twelve pins after the user-request pins in `.bad.ts`
and item 21 in `.good.ts`.

**The commit-range member (2026-09-30).** A git range of two 7-40
character hex ids, each holding at least one hex letter,
`(?=[0-9]*[a-f])[0-9a-f]{7,40}\.{2,3}(?=[0-9]*[a-f])[0-9a-f]{7,40}`, in
both arms: "a build from 6c3190ee..28eb0967" cites history the same way
a branch name does. The three-dot form counts too. "a 0..255 byte", "the
a..f digits", "cafe..beef", "1234567.89", and a digit-only span such as
"1700000000000..1700086400000" (two epoch-millisecond numbers) stay
silent. The sweep found 1 hit, in `reminder-row.component.tsx`,
reworded. Fixture pair: the three commit-range pins at the end of
`.bad.ts`, and item 22 plus the digit-range pin after it in `.good.ts`.

**Case forms (2026-10-05).** A member that names a plain word takes both
its lower-case and its capitalized form, because a real comment opens a
sentence with it ("(review Bug 8)" drew no finding while the member read
`bug`). Three members stay capital-only, because the lower-case form is
ordinary prose: `Task\s\d+` (a pool test's "task 0 settles last" is a task
index, `settle-limited.test.ts`), `Minor\s\d+` ("a minor 3% drift"), and
`Requirement\s[A-Z]` ("the requirement I mentioned"). Widening the case
found three real hits in `src`, each reworded in the same change. Fixture
pair: the case pins at the end of `.bad.ts` and item 23 in `.good.ts`.

**Set, task, track and run ids, and a decision answer (2026-10-23).** Seven members, in both
arms and in `kiko-no-history-id-shell-comment`, each narrow enough that a bare "task 0" or "set 0"
stays prose (`.good.ts` item 28):
- `\bH\d{1,2}\s+(?i:task|set|step|fix\sround|backlog|track)\b` and `\bH\d{1,2}\s+t\d+\b`: a track
  id joined to a task word in either case (`H10 task 4/4`, `H10 Set 3`, `H9 t3`). The word group
  is case-insensitive and identical in all three copies (the two `semgrep-prewrite.yml` arms and
  `kiko-no-history-id-shell-comment`). A bare `H\d+` is NOT a member: `(H1)`, `(H3)` (section ids
  in `plist.sh`), `H264` and `H2 database` are ordinary tokens.
- `\b\d{8}T\d{4}-kiko-[\w-]+`: a run id (`20261023T0023-kiko-harness-h10`).
- `[Ss]et\s\d+/\d+` and `[Tt]ask\s\d+/\d+`: a set or task counter (`set 3/5`, `task 2/3`).
- `(?:[Ss]et|[Tt]ask)\s\d+\s+(?:review|fix\sround|step|plan|survivors?|tip|gate)\b`: a set or
  task id followed by a process word (`the set 9 review`). The word needs its own boundary, so
  "set 3 steps" stays silent.
- `\bQ\d{1,2}\s*=\s*[A-Z]\b`: a decision answer (`Q2 = A`). "The Q2 tabs-vs-chips rule" and
  "Q2 2026" stay silent.

Known limits (accepted false positives, 0 sites in the tree): a ratio such as "set 16/9 aspect
ratio" reads as a set counter, "Mark the task 1 step done" reads as a task id followed by a
process word, and "Q1 = P" reads as a decision answer. Reword the prose ("a 16:9 aspect ratio"),
or use the override protocol for a real site. Fixture pair: the pins at the end of `.bad.ts` and
`.bad.sh`, and item 28 in `.good.ts` with the matching lines at the end of `.good.sh`.

**What a finding is (both history rules).** Each arm reports every
watched id or word of a comment, one finding per member: a PCRE `\K` right
before the member drops everything before it from the match, and the block
arm's closing `*/` is a lookahead after the member, so the matched text is
the member alone. The opener of each arm is an alternation, the line-start
walk to the `//` or `/*` OR `(?!\A)\G`, which resumes at the end of the
previous match, so a second member of the same comment is found too. The
continuation cannot leave the comment: the line arm's lead-in `[^\n]*?`
stops at the line end, and the block arm's `(?:(?!\*/)[\s\S])*?` stops at
a `*/`. A `\G` match never opens a comment either, so `/* ok */ const t =
"no longer"` reports nothing. The pre-write guard keys a finding on (rule,
matched text) and counts the findings of one key, so an Edit of other text
in a comment that already holds a finding adds nothing; a new or changed id
or word, or a second one in the same comment, is new. A block comment is
reported at the line of its watched id, not at its `/*` line, so an
`EXPECT-FINDING` pin for a later line of a block comment sits inside the
comment, and so must a `// nosemgrep: <id> OVERRIDE(...)` for it: only the
member's own line or the line above it counts, because
`pre-write-guard.js` checks the finding's line and the line above. A
`/* nosemgrep: <id> OVERRIDE(...)` on the `/*` line still counts when the
member sits on the next line. No override of either rule exists in
`src` today. Two members on one line cannot be pinned apart: one pin per
line. When the key already existed, the deny cannot tell which of several
equal findings the edit added (the count ranks in file order, so a word
added above an old one ranks first), so it names every line that holds the
key: `one of lines 3, 7, 9 is new; reword the one you added` (this holds for
every Semgrep and Node rule, the shared code in `pre-write-guard.js`).
Both arms still read `//` and `/*` by line-start text, so three limits
stand (0 id hits and 0 word hits are hidden by them in `src` today). A
`/*` inside a `//` comment (`// the glob src/*.ts`) opens a fake block arm
that runs to the next `*/`: any watched word between reads as a finding, in
code or a string too, reported at the word. A later line of a multi-line
template literal that starts with `//` reads as a line comment. The line
walk is greedy, so it opens at the LAST `//` of the line: a member before a
later `//` of the same comment (`// no longer here // see the note`) is not
found. Reword any of these.

## `kiko-no-history-word-comment`

The change-narrative half of kiko-code-style's "Comments: WHY only, never
history". `kiko-no-history-id-comment` catches an id or a citation; this
rule catches the phrases a comment uses to narrate a change, among them a
`was:` label before an old value (`// was: 30`, ` * was: the old cap`), and `as before`
at the end of a clause (`fails as before`, `as before, ...`; a noun phrase after it, such as
`as before the request`, is an ordering and stays silent). A comment states how the code
works today and why, never how it worked before.
The members are the `pattern-regex` alternation and the `message` of
`kiko-no-history-word-comment` in `rules/semgrep-prewrite.yml`; read the
phrases there, never copy them. The match is capitalization-tolerant, and
the fixture pair shows each shape.

**A separate rule id, severity ERROR.** Severity is per rule, so the words could not ride
on the id rule while findings remained. The sweep landed, and the tree holds 0 findings for
this rule id. Count the live findings with
`semgrep --metrics off --quiet --config rules/semgrep-prewrite.yml src --json`,
filtered to `kiko-no-history-word-comment` (it reports every word of a comment, so a
comment holding two words counts twice). `check:security` fails on a finding, and the
pre-write guard denies a NEW one.

**Known false positives.** `as before` at the end of a physical line, when its noun phrase
wraps to the next line, reads as a clause end. `as before and after` reads as a clause end
too. Reword such a comment.

**Hand-run scan target.** A rule's `paths.exclude` (for example `__tests__/**`) is
relative to the semgrep scan target. A hand-run count or sweep (every comment-history rule: id,
word, date, task-id) must target the repo root (`.`) or single files; a directory target such as
`__tests__` makes the paths relative to it, so the exclude misses (a 2026-10-06 sweep counted 6
excluded `__tests__` files that way). `src` as a target is fine for these rules.

The anchoring is the id rule's: the same string-skip
`^(?:…)*` walk, `(?<!:)//` for the line arm, the block arm that never
crosses `*/`, the same `\K` match shape (see "What a finding is" in the
id rule's section: only a new or changed word is a new finding, not an edit
of other text in its comment), and the same `paths.exclude` scope (`__tests__/**`,
`e2e/**`, `scripts/**`, `harness/**`, `App.tsx`, `drizzle.config.ts`;
`__mocks__/**` and co-located test files stay in scope).

**Measured false-positive classes.** Counts below are the hits measured at the
time, not live counts. Every phrase was counted over `src`
(`semgrep --metrics off --quiet --config rules/semgrep-prewrite.yml src
--json`, `paths.scanned` read first), and a hand read classified each hit:

- `used to`: the purpose sense ("a key used to match the holding") reads
  like the habit sense ("this used to render a spinner"). Two classes
  were clean and are narrowed: a passive lead-in
  (`is`/`are`/`was`/`were`/`be`/`been`/`being`/`get`/`gets`/`got used to`, a
  fixed-width lookbehind in the regex) or `is`/`are`/`was`/`were never used
  to`, and a capitalized `Used to`, which opens a purpose fragment ("Used to
  price the buckets."). They were 8 of the first 106 hits (5 capitalized, 2
  `is never`, 1 `is`), and every one was purpose. A bare `never used to`
  stays a finding: "The sheet never used to flicker" is history. The member
  keeps a lowercase `used to` only. A noun-then-participle purpose sentence
  ("the key used to match") has no regex separator from "the wrapper used to
  own", so about 10 purpose hits remained among the hits measured at the
  time (a comma or em dash
  before `used to` held 6 purpose and 2 history hits, too mixed to narrow).
  The lookbehind sees only the word right before the phrase, so "is only
  used to resume" and an `is` at the end of one comment line with `used to`
  opening the next also read as history: known limits, pinned as findings
  in `.bad.ts`. Reword such a comment to name the purpose ("matches the
  holding") instead of "used to".
- `no longer`: the runtime-state sense ("a kind the app no longer knows",
  "a card the snapshot no longer returns", "once it no longer
  corresponds") is common: a large share of the hits measured at the time. No regex separates it
  from "the sync no longer writes it", so the member is not narrowed. A
  runtime-state sentence gets reworded to name the state ("a kind outside
  the current list", "a card absent from the snapshot").
- `previously`: a data-state sense ("a previously-linked row", "previously
  rejected", "previously stored rates") held 14 of the 34 hits. A hyphenated
  `previously-<participle>` was 8 of 11 data-state, but it also held 2
  true history hits, so it is not narrowed either.
- `was:`: a label, not a word, so it needs the colon and the `\b` before it, and sits beside the
  other members as `(?:\b(?:…)\b|\b[Ww]as:)` (the closing `\b` of the word members cannot follow
  a colon). `wasm:` (no boundary after `was`), the word `was` in prose, an object key
  `{ was: 1 }` and a string `'was: 30'` stay silent (pinned in `.good.ts`; the string and the key
  are not comment text, and the line arm's string-skip walk never opens on them). Measured on
  2026-10-11: 0 hits over `src`, `App.tsx` and the repo (`semgrep … . --json`, 1839 paths
  scanned; a plain `grep -rE '\b[Ww]as:'` over `src` finds no occurrence in code or comments
  either): 0 hits in the tree, nothing to sweep. The colon is the only key, so three false
  positives are known and pinned in `.bad.ts` (prose such as "the question was: …", a URL path
  segment `…/was:thing`, a JSDoc example holding `{ was: 1 }`); reword such a comment. Its only
  hits are the `was:` pins in the bad fixture. A scan of the whole repo hits the 3 per-rule timeouts on
  `holding-form.screen.test.tsx` under load; scan that file alone to read its hits.
- `it replaces`: 2 of the 6 hits were a behavior description ("while
  locked it replaces the whole app with a prompt"); the other 4 named the
  old code ("the scan it replaces"). Not narrowed.

A NEW phrase is tested against legitimate comments (the good fixture) before
it ships, narrowed with a following noun or preposition so a bare verb does
not match, made capitalization-tolerant, and pinned in both fixtures.

Narrowing a member needs its own measured false-positive class and a
fixture pin on each side (an excluded shape in `.good.ts`, a caught
shape with `// EXPECT-FINDING` in `.bad.ts`); a sweep cap or a long hit
list is never a reason. Any other good fixture that carries a watched
word in a comment fails `check:rules` ("must draw zero findings from
every rule"): `kiko-no-undefined-nitro-prop.good.tsx` had to reword one
"it replaces" comment when this rule landed.

## `kiko-no-history-date-comment`

The date half of kiko-code-style's "Comments: WHY only, never history": a
date attached to a ruling, a finding, or a plan left in a `src/**` comment
("user-approved 2026-10-08", "Device finding", "(multi-account plan,
2026-09-11)"). The members are the two `pattern-regex` alternations in
`kiko-no-history-date-comment` (`rules/semgrep-prewrite.yml`): `Device
finding(s)`; `approved|probed|ruled|ruling|decided|confirmed` (also the all-caps `RULED`/`RULING`) then an ISO date, with an
optional `on` or `of` between ("ruling of 2026-10-12", "ruled on 2026-10-12") and a
comment wrap tolerated between the word and the date; `plan|track|round|ruling|feedback|audit`,
a comma, then an ISO date; a `docs/` path holding a dated file name; and a parenthesized
date that opens the comment text (`* (2026-09-11) moves …`). A probe's date is history
too: `probed <date>` is a member, and the comment states what the probe showed, never when it
ran. The anchoring is the
history rules': the string-skip `^(?:…)*` walk, `(?<!:)//`, the block arm that never
crosses `*/`, the `\K` match shape, and the same `paths.exclude` scope. The pair is flat
(`rules/fixtures/kiko-no-history-date-comment.{bad,good}.ts`).

**Severity ERROR from the start.** A sweep of 12 sites in 11 files landed with the rule,
so `check:security` reports 0 findings for the id.

**A bare ISO date is NOT a member, by measurement.** Over `src` a bare
`\d{4}-\d{2}-\d{2}` inside a comment hit 55 times; the 12 history hits were swept and the
other 43 (27 files) are data, not history: a test's fixture day (`// 2026-01-15` after a
`Date.UTC`), a DST day (`Europe/Kyiv falls back on 2026-10-25`), a leap day, a worked example
(`Date.UTC rolls 2026-09-31 into October` in `reminder-schedule.ts`), a date format sample,
and provenance of a snapshot or a check (`captured 2026-09-22` in `fiat-rate-seed.ts`,
`checked 2026-09-26` in `week-start.ts`). A date records WHEN a value was captured, which
the code cannot show, so provenance and fixture days stay, and `fiat-rate-seed.ts` keeps its
documented exception in kiko-code-style. The rule: only a date that follows a ruling, probe,
plan, or finding word counts. No exemption list exists, so there is nothing in
`docs/harness/documented-exceptions.md` to update. Known misses: a date after another word
("signed off 2026-10-08"), a date with no word before it, and a dated history sentence that
names no ruling word. Reword by hand when a review finds one.

**Known false positive.** The wrap tolerance between the word and the date matches
"was approved" at the end of a comment line when the next comment line starts with a date,
for example a fixture day. Reword the comment so the date does not open a line.

## `kiko-no-task-id-comment`

The id half of kiko-code-style's "Comments: WHY only, never history" that
`kiko-no-history-id-comment`'s fixed list cannot reach: a task, item,
bug, or finding id of the multi-round process left in a `src/**` comment
(`DEVICE BUG fix`, `Bug A2`, `Feature 1`, `Global Constraint 2`, `item 6`,
`Part A`, `Track A`, `Invariant #15`, `finding S4`, `ponytail L43`, a
letter-prefixed finding id such as `SEC-C1`/`TX-C6a`, a parenthesized
plan id such as `(A1)`/`(P3)`, and a ruling id such as `ruling A2`/`RULING B1`). The members are the two `pattern-regex`
alternations in `kiko-no-task-id-comment` (`rules/semgrep-prewrite.yml`);
the fixture pair shows each shape.

**A separate rule id, severity ERROR.** Severity is per rule. The promotion condition
(`check:security` reports 0 findings for this rule id) was met, so the rule fails
`check:security`, and the pre-write guard denies a NEW one. Count the findings with `semgrep --metrics off --quiet --config
rules/semgrep-prewrite.yml src --json`, filtered to this rule id.

The anchoring is the two history rules': the same string-skip `^(?:…)*` walk,
`(?<!:)//` for the line arm, the block arm that never crosses `*/`, the `\K`
match shape, and the same `paths.exclude` scope. The pair is flat
(`rules/fixtures/kiko-no-task-id-comment.{bad,good}.ts`): the rule has no
`paths.include`.

**Precision over recall.** Every shape below was counted over `src` comments
first, and a shape that hit prose was dropped or narrowed:

- Kept whole: `DEVICE BUG` (a labelled device-review bug note, about 30
  hits), `Feature \d+`, `Global Constraint \d+`, `Invariant|CRITICAL|MAJOR|MINOR
  #\d+`, `ponytail L\d+`, `[Ff]inding [A-Z]\d+`. None read as plain prose.
- `[Bb]ug|BUG` plus a capital letter and optional digits (`BUG A fix 1`,
  `Bug B1`, `bug A2`): the letter class skips `I`, so "the bug I traced" is
  prose, and the lowercase `Bug A` article reading is a known tiny risk.
  `THE POSITION-SCALING BUG` and a bare "bug" name no id and stay silent.
- `[Ii]tem \d+`: all 25 hits were ids, but "an item 3 levels down" would read
  as one too (a known limit, pinned as a finding in `.bad.ts`).
- `Part|Track` plus a capital letter (not `I`): `Part B`, `Track A`. A
  lowercase "part of" or "a track of" stays silent.
- `[A-Z]{2,5}-[A-Z]\d{1,3}[a-z]?`: the LETTER after the hyphen separates a
  finding id (`SEC-C1`, `REF-C14`, `TX-C6a`, `STAT-N4`) from `UTF-8`,
  `SHA-256`, `ISO-8601`, `AES-256`, `BCP-47`, `CLDR-14795`, `UTC-9`, `NOW-2d`,
  and `WCAG-AA`. The digit-only `SEC-12` family stays with
  `kiko-no-history-id-comment`. The history rule's single-letter members
  (`C`, `N`, `M`, `T`, `R`, `D`, and the others in its list) also match
  after the hyphen in `SEC-C1` and inside `(M1)`, so for those letters both
  rules fire (both ERROR); this rule's letter-prefixed shape adds
  cover only for second letters the history rule lacks (`SEC-A1`, `TX-B6a`).
- `[Rr]ulings?`/`RULINGS?` plus a capital letter, a digit, and an optional trailing lowercase
  letter (`ruling A2`, `RULING B1`, `ruling A2b`), with a comment wrap tolerated between the
  word and the id. "ruling 3" (no letter) and "ruling A" (no digit) stay silent.
- A parenthesized letter and one digit, `(A1)`/`(P3)`: `(S3)` and `(H1)` are
  excluded by a lookahead (a cloud name and a heading level). A single letter
  in parentheses (`(B)`, `uahPer(A)`) and a spreadsheet range (`A1:J1`) stay
  silent; a spreadsheet cell written `(A1)` is a known limit, so write
  "cell A1".
- Left OUT, because the hits were domain words: `Step N` (an algorithm
  documented step by step), `Phase A/B` (the rezone phases), `Rule B`/`Rule N`
  (the matcher's own rules), `task 0` (a test's own tasks; the set and task counters
  `task 2/3` and `set 3/5` are members of `kiko-no-history-id-comment`, not of this rule), and a
  bare letter and digit (`A1's`, `P1:`, which collide with cells, regex classes,
  and chip names).

Any other good fixture that carries one of these shapes in a comment fails
`check:rules` ("must draw zero findings from every rule");
`kiko-no-history-id-comment.good.ts` had to reword one `item 5's` when this
rule landed.

## `kiko-no-change-language-in-test-body`

Mechanizes kiko-translator's "A test sets the language in a hook, never in an `it`
body": a `$I18N.changeLanguage(...)` call inside an `it(...)`, `test(...)`, `it.only(...)`,
`it.each(table)(...)`, or `test.each(table)(...)` callback. Six `pattern-inside` arms; the
call may sit in an `act(...)` inside the body. `beforeEach`, `afterEach`, `beforeAll`, and
`afterAll` are not test bodies, so the hook form never matches.

**Severity WARNING (Class B), because the tree already holds findings.** The finding
count is what `check:security` reports for this id (`semgrep --metrics off --quiet --config
rules/semgrep-prewrite.yml src --json`); re-measure before quoting it. Most findings set `uk` in
the body and reset in an `afterEach`, which is safe until an assertion throws between a
body-level switch and its reset, and which the rule cannot tell apart from the unsafe form.
Sweeping every site is far past one dispatch, so the rule landed with no gate, as step 4 of
"Adding a pre-write guard rule" allows: `check:security` surfaces the findings without
failing, and the pre-write guard denies a NEW `changeLanguage` call in a test body (the
finding key is the call text, so a second `i18n.changeLanguage('uk')` in a file that
already holds one counts as new). **Promotion condition:** flip to ERROR when
`check:security` reports 0 findings for this rule id (never when a grep is empty).

**Scope.** `paths.include` is `*.test.ts`, `*.test.tsx`, and `src/test-support/**`. The
last entry is path-prefixed, so the fixture pair is NESTED under
`rules/fixtures/kiko-no-change-language-in-test-body/src/test-support/`. Test-support
helpers are in scope only so the fixture probe can reach the rule.

**Known limits.** A helper that wraps `changeLanguage` and is called from an `it` body
leaks the same way and is not seen. A `jest.spyOn(i18n, 'changeLanguage')` is not a call
and stays silent. A `try`/`finally` reset inside the body still matches: use a hook.

## `kiko-test-title-no-history`

Mechanizes kiko-code-style's "A test title carries no history": the title of an `it`,
`test`, or `describe` call (also `.only`, `.skip`, `.todo`, `.each(table)(...)`, and a tagged
`.each` table) that opens with a task id (`A1 `, `A1:`), opens with a ruling id (`ruling A2`),
opens with a numbered device check (`device check 3`, either case), carries `(was: `, `(was 44)`
or `; was 62` (an old-value label), or ends in a task id in parentheses (`(P2)`, `(task C2)`,
`(spec A3, B4)`). `it was 44 rows`, `(was 3 of them)` and `; was 3x faster` stay silent: `(was N)`
needs the digits to close the parenthesis, and `; was N` needs the semicolon and a word boundary
after the digits. A spec ruling id (`S\d{1,3}-Q\d{1,3}`), review-question id (`FQ\d{1,3}`) or spec
clause id (`C-NR-?[A-Z0-9]+`) is caught anywhere in the title, as `kiko-no-history-id-comment`
catches it in a comment; `FQDN`, `AS12-Q3`, a bare `S12` or `Q3` and a bare `C-NR` stay silent.

**Severity ERROR from the start.** The tree holds 0 findings. Re-measure with `semgrep
--metrics off --quiet --config rules/semgrep-prewrite.yml src __tests__ --json` before quoting
a count (the rule also covers `__tests__/*.test.ts`).

**Scope.** Test-only: `paths.include` is `*.test.ts`, `*.test.tsx`, and `src/test-support/**`.
The last entry is path-prefixed, so the fixture pair is NESTED under
`rules/fixtures/kiko-test-title-no-history/src/test-support/` (`title-example.bad.ts` and
`title-example.good.ts`). It is one `$CALLEE($TITLE, ...)` pattern with a `metavariable-regex`
on the callee and one on the title text.

The rule matches `Task C2` and `task C2` (`[Tt]ask`) in the trailing parenthesis.

**Known limits.** A title held in a variable, or built from anything but a string or a
template literal, is out of reach. A leading letter-and-digits that is data (`B12px`, `a1:`)
and a parenthesis that holds more than an id (`(A4 paper)`, `(P2P)`) stay silent. A
multi-letter id (`(BUG1)`, `(SEC-12)`, `(T-12)`, `(P2b)`) and a ruling id in the middle of a
title (`(ruling A2)`) are missed. A one-letter id that is data false-matches: `(H1)`, `(V2)`,
`(B2)`, `(A4, portrait)` in the trailing parenthesis, and a leading `A1: header cell`. Reword
such a title.
