# Plan: Kiko agent harness plugin (nine agents, ponytail isolated)

## Metadata

- **Goal:** Package the nine-agent harness as a local Claude Code plugin. Isolate ponytail to the reviewer. Reuse superpowers. Set a model and an effort level per agent.
- **Tech stack:** Claude Code plugins (agents, skills, commands, hooks), superpowers, vendored ponytail 4.9.0.
- **Spec:** `docs/superpowers/specs/2026-08-30-kiko-scaffold-and-harness-design.md` (Sections 6, 7, and 8).
- **Scope:** This plan builds the agent plugin only. The scaffold is plan #1. The quality harness is plan #2.
- **Status:** Not started.

## Branch isolation note

This plan runs inside its own Orca worktree branch. Every commit stays on that branch. The coordinator presents the branch to the user before any merge to `main`.

## Confirmed platform facts (baked in — do not re-question)

- The plugin manifest is `<plugin-root>/.claude-plugin/plugin.json`. The installed superpowers plugin uses exactly this shape (name, description, version, author). Confirmed by inspection.
- Plugin agents live in `<plugin-root>/agents/*.md`. Required frontmatter: `name`, `description`. Optional: `model`, `tools`.
- Agent frontmatter `model` accepts `opus | sonnet | haiku | inherit`. It cannot pin a specific model id.
- There is no per-agent frontmatter for effort or reasoning. Effort is set at launch with `claude --effort <level>` (levels: low, medium, high, xhigh, max). So each agent file records its intended effort as a metadata comment. The coordinator applies `--effort` when it spawns that agent in its Orca worktree.
- Superpowers ships skills only (no `agents/` directory). Reuse its skills directly. Do not copy them.
- Ponytail's review logic is self-contained in `commands/ponytail-review.toml`. Tags: delete / stdlib / native / yagni / shrink. Output line: `L<line>: <tag> <what to cut>. <replacement>.` Ending: net removable lines, or "Lean already. Ship." Vendor only this. Register no ponytail hooks.

## Global Constraints

- Do not install ponytail as a plugin. Vendor only its review prompt into the reviewer. Register no `SessionStart`, `SubagentStart`, or `UserPromptSubmit` hooks from ponytail. Pin the vendored source to ponytail 4.9.0.
- Reuse superpowers skills directly. Do not copy them. Project skills only wrap or point to them.
- Each agent gets `model` in frontmatter and a recorded effort level for `--effort` at launch.
- The plugin is local to the repo at `harness/kiko-harness/`.

---

## Task 1 — Verify the installed plugin and agent schema

**Steps:**

- [ ] Print the installed Claude Code version:
  ```bash
  claude --version
  ```
- [ ] Confirm the manifest location and the plugin layout against the installed superpowers plugin:
  ```bash
  ls ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/.claude-plugin/plugin.json
  ```
- [ ] Confirm which optional agent frontmatter fields the installed version supports (`model`, `tools`, `permissionMode`, `color`). Read the current agent docs:
  ```bash
  # Reference: https://code.claude.com/docs/en/sub-agents
  ```
- [ ] Confirm the marketplace manifest schema, because Task 8 depends on it. Verify the manifest location `<marketplace-root>/.claude-plugin/marketplace.json` and the `plugins[].source` field against the installed version:
  ```bash
  # Reference: https://code.claude.com/docs/en/plugin-marketplaces
  ```
- [ ] Record the confirmed field list. The later tasks use only confirmed fields.

**Verification:**

- [ ] The recorded field list names every frontmatter field used in Task 3.
- [ ] The recorded marketplace schema confirms the `plugins[].source` field and the manifest location used in Task 2 and Task 8.

---

## Task 2 — Plugin skeleton

**Files:**

- Adds `harness/.claude-plugin/marketplace.json` (the marketplace manifest that Task 8 registers).
- Adds `harness/kiko-harness/.claude-plugin/plugin.json`.
- Adds empty `harness/kiko-harness/agents/`, `skills/`, `commands/`, `hooks/`.

**Steps:**

- [ ] Create the directories, including the marketplace manifest directory:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  mkdir -p harness/.claude-plugin harness/kiko-harness/.claude-plugin harness/kiko-harness/agents \
    harness/kiko-harness/skills harness/kiko-harness/commands harness/kiko-harness/hooks
  ```
- [ ] Write `harness/kiko-harness/.claude-plugin/plugin.json`:
  ```json
  {
    "name": "kiko-harness",
    "version": "0.1.0",
    "description": "Kiko agent harness: nine role agents, isolated ponytail review, and tiered quality hooks.",
    "author": { "name": "Kiko" },
    "keywords": ["agents", "harness", "react-native", "quality"]
  }
  ```
- [ ] Write the marketplace manifest `harness/.claude-plugin/marketplace.json`. Task 8 registers this. Adjust the field names only if Task 1 finds the installed version differs:
  ```json
  {
    "name": "kiko-harness-marketplace",
    "owner": { "name": "Kiko" },
    "plugins": [
      {
        "name": "kiko-harness",
        "source": "./kiko-harness",
        "description": "Kiko agent harness: nine role agents, isolated ponytail review, and tiered quality hooks."
      }
    ]
  }
  ```

**Verification:**

- [ ] Both manifests parse as JSON:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('harness/kiko-harness/.claude-plugin/plugin.json','utf8'));console.log('plugin ok')"
  node -e "JSON.parse(require('fs').readFileSync('harness/.claude-plugin/marketplace.json','utf8'));console.log('marketplace ok')"
  ```

**Commit:**

- [ ] `git add -A && git commit -m "feat(plugin): add kiko-harness plugin skeleton"`

---

## Task 3 — The nine agent files

Create one file per agent under `harness/kiko-harness/agents/`. Each file states its role, its boundaries, its recorded effort (a metadata comment), and its superpowers links. Group the commits: core coding agents first, review and test agents next, support agents last.

Model and effort table:

| Agent | model | effort |
|---|---|---|
| developer | opus | high |
| debugger | opus | high |
| reviewer | opus | high |
| qa | sonnet | high |
| designer | sonnet | high |
| explorer | sonnet | medium |
| retrospect | sonnet | medium |
| scribe | sonnet | low |
| ops | haiku | low |

**Files:**

- Adds `agents/explorer.md`, `debugger.md`, `developer.md`, `reviewer.md`, `qa.md`, `retrospect.md`, `scribe.md`, `ops.md`, `designer.md`.

### Step 3a — Coding agents (developer, debugger)

- [ ] Write `agents/developer.md`:
  ```markdown
  ---
  name: developer
  description: Writes all TypeScript and React Native code for Kiko. Use for any feature or bugfix implementation.
  model: opus
  tools: Read, Write, Edit, Bash, Grep, Glob
  ---
  <!-- effort: high (launch with: claude --effort high) -->

  You write all TypeScript and React Native code for Kiko.

  Rules:
  - Use test-driven development. Invoke the superpowers:test-driven-development skill before you write code.
  - Work inside a git worktree. Invoke superpowers:using-git-worktrees.
  - Consume the design system from the designer. Do not invent styles; import the theme tokens.
  - Run the harness checks after each change: npm run check:lint and, at checkpoints, npm run check:deep.
  - Fix the code when a check fails. Never weaken a check.

  You do not review your own diffs for merge. The reviewer does that.
  ```
- [ ] Write `agents/debugger.md`:
  ```markdown
  ---
  name: debugger
  description: Runs debug steps and reports the root cause. Writes NO code. Use to isolate a bug or a test failure.
  model: opus
  tools: Read, Grep, Glob, Bash
  ---
  <!-- effort: high (launch with: claude --effort high) -->

  You isolate faults and report the root cause. You write no code.

  Rules:
  - Invoke the superpowers:systematic-debugging skill first.
  - Reproduce the fault. Narrow it with real commands and logs.
  - Report the root cause and a conclusion. Propose the fix in words.
  - You have no Edit or Write tool. Hand the fix to the developer.
  ```

**Verification (3a):**

- [ ] Both files have valid frontmatter and appear in the agent list once the plugin is registered (Task 8).

**Commit:** `git add -A && git commit -m "feat(plugin): add developer and debugger agents"`

### Step 3b — Review and test agents (reviewer, qa)

- [ ] Write `agents/reviewer.md`:
  ```markdown
  ---
  name: reviewer
  description: Reviews diffs for correctness and over-engineering using the vendored ponytail review. Use before a merge.
  model: opus
  tools: Read, Grep, Glob, Bash
  ---
  <!-- effort: high (launch with: claude --effort high) -->

  You review diffs. You do not fix code; you report findings.

  Rules:
  - Run the vendored ponytail review: /ponytail-review (see the plugin command). It reports what to cut.
  - Also invoke superpowers:requesting-code-review for correctness findings.
  - Report findings grouped as: correctness, then over-engineering (the ponytail tags).
  - The ponytail persona applies only to this review. It does not change your output style elsewhere.
  ```
- [ ] Write `agents/qa.md`:
  ```markdown
  ---
  name: qa
  description: Writes tests for Kiko — Jest and React Native Testing Library for units, Maestro for iOS E2E.
  model: sonnet
  tools: Read, Write, Edit, Bash, Grep, Glob
  ---
  <!-- effort: high (launch with: claude --effort high) -->

  You write tests for Kiko.

  Rules:
  - Invoke superpowers:test-driven-development.
  - Unit and component tests: Jest with @testing-library/react-native, in __tests__/.
  - iOS end-to-end tests: Maestro YAML flows.
  - A test must assert real behavior. An assertion-free test fails the Stryker check.
  ```

**Verification (3b):** both files parse and list. **Commit:** `git add -A && git commit -m "feat(plugin): add reviewer and qa agents"`

### Step 3c — Support agents (explorer, retrospect, scribe, ops, designer)

- [ ] Write `agents/explorer.md`:
  ```markdown
  ---
  name: explorer
  description: Read-only search for context and code across the repo. Use to locate code before a change.
  model: sonnet
  tools: Read, Grep, Glob
  ---
  <!-- effort: medium (launch with: claude --effort medium) -->

  You search the codebase and return context. You are read-only.

  Rules:
  - Return file paths, line numbers, and short excerpts. Do not dump whole files.
  - You have no Bash, Edit, or Write tool. You only read.
  - For parallel searches, the coordinator uses superpowers:dispatching-parallel-agents.
  ```
- [ ] Write `agents/retrospect.md`:
  ```markdown
  ---
  name: retrospect
  description: Gathers durable lessons after each run and hands them to the scribe. Use at the end of a task.
  model: sonnet
  tools: Read, Grep, Glob, Bash
  ---
  <!-- effort: medium (launch with: claude --effort medium) -->

  You gather durable lessons after a run.

  Rules:
  - Review what worked, what failed, and what to change next time.
  - Write short, specific lessons. Hand them to the scribe to record.
  - You do not edit skills, agents, or the plugin. The scribe does that.
  ```
- [ ] Write `agents/scribe.md`:
  ```markdown
  ---
  name: scribe
  description: Records durable facts and lessons into memory, skills, agents, or the plugin. Use to persist knowledge.
  model: sonnet
  tools: Read, Write, Edit, Bash, Grep, Glob
  ---
  <!-- effort: low (launch with: claude --effort low) -->

  You record durable knowledge.

  Rules:
  - Record a fact in the right place: the memory dir, a skill, an agent file, or the plugin.
  - Use superpowers:writing-skills and skill-creator when you edit a skill.
  - Track the vendored ponytail version (4.9.0) and update it when needed.
  - Keep each memory to one fact with the required frontmatter.
  ```
- [ ] Write `agents/ops.md`:
  ```markdown
  ---
  name: ops
  description: Runs project commands and scripts and owns the infrastructure. Use for builds, installs, and tooling.
  model: haiku
  tools: Read, Grep, Glob, Bash
  ---
  <!-- effort: low (launch with: claude --effort low) -->

  You run project commands and scripts. You own the infrastructure.

  Rules:
  - Run builds, installs, pod install, and the harness checks.
  - Report the exact command, its output, and the result.
  - You do not write app code. Hand code changes to the developer.
  ```
- [ ] Write `agents/designer.md`:
  ```markdown
  ---
  name: designer
  description: Owns the in-app design system — theme tokens, colors, spacing, typography, and shared styled components.
  model: sonnet
  tools: Read, Write, Edit, Bash, Grep, Glob
  ---
  <!-- effort: high (launch with: claude --effort high) -->

  You own the Kiko design system.

  Rules:
  - Define theme tokens: colors, spacing, typography, and radii.
  - Build shared styled components. The developer consumes them.
  - When the user provides a Figma file, use the figma plugin skills to pull the design.
  - Keep one source of truth for styles. Do not scatter inline styles.
  ```

**Verification (3c):** all five files parse and list. **Commit:** `git add -A && git commit -m "feat(plugin): add explorer, retrospect, scribe, ops, designer agents"`

**Task 3 verification:**

- [ ] All nine agent files parse. Each declares the model from the table. Each records its effort as a comment.

---

## Task 4 — Vendor the ponytail review into the reviewer

Vendor only the review prompt from ponytail 4.9.0. Register no ponytail hooks.

**Files:**

- Adds `harness/kiko-harness/commands/ponytail-review.md`.

**Steps:**

- [ ] Confirm the source version:
  ```bash
  # Source: https://github.com/DietrichGebert/ponytail  (tag v4.9.0, commands/ponytail-review.toml)
  ```
- [ ] Write `harness/kiko-harness/commands/ponytail-review.md`:
  ```markdown
  ---
  description: Review the current diff for over-engineering and report what can be cut.
  ---
  <!-- VENDORED from ponytail 4.9.0 (commands/ponytail-review.toml). Source: https://github.com/DietrichGebert/ponytail
       Only this review prompt is vendored. No ponytail hooks are registered. Only the reviewer agent uses it. -->

  Review the diff below for over-engineering. Report only what can be cut. Do not comment on correctness here.

  First, get the diff:
  ```bash
  git diff
  ```

  Tag each finding with exactly one tag:
  - delete — dead code or a speculative feature that is not needed now.
  - stdlib — reinvents something the standard library already provides.
  - native — a dependency does what the platform already does.
  - yagni — an abstraction with only one implementation.
  - shrink — the same logic written in fewer lines.

  Output one line per finding, in this exact form:
  L<line>: <tag> <what to cut>. <replacement>.

  End with the net number of removable lines. If there is nothing to cut, write exactly:
  Lean already. Ship.
  ```

**Verification:**

- [ ] The reviewer agent runs `/ponytail-review` on a sample diff and returns findings in the `L<line>: <tag> ...` form.
- [ ] Confirm no ponytail hooks exist and the STE style is intact for every other agent and the main session:
  ```bash
  grep -rn "ponytail" harness/kiko-harness/hooks/ 2>/dev/null   # expect: no output
  ls ~/.claude/.ponytail-active 2>/dev/null || echo "no ponytail marker (good)"
  ```

**Commit:**

- [ ] `git add -A && git commit -m "feat(plugin): vendor ponytail 4.9.0 review for the reviewer only"`

---

## Task 5 — Project workflow skills

Create thin skills that wrap superpowers. Each skill points to the superpowers skill; it does not copy it.

**Files:**

- Adds `harness/kiko-harness/skills/harness-workflow/SKILL.md`.
- Adds `harness/kiko-harness/skills/design-system/SKILL.md`.
- Adds `harness/kiko-harness/skills/retrospect/SKILL.md`.
- Adds `harness/kiko-harness/skills/ops/SKILL.md`.

**Steps:**

- [ ] Write `skills/harness-workflow/SKILL.md`:
  ```markdown
  ---
  name: harness-workflow
  description: Use when coordinating Kiko work. States the delegation rule and points to the superpowers process skills.
  ---

  The coordinator delegates all work to the harness agents. The coordinator never edits app files inline.

  Rules:
  - Split complex or parallel work into separate Orca worktrees (orca-cli).
  - If no agent fits a task, report the gap. Do not do the task inline.
  - Use these superpowers skills directly: brainstorming, writing-plans, executing-plans,
    subagent-driven-development, dispatching-parallel-agents, verification-before-completion,
    finishing-a-development-branch.
  ```
- [ ] Write `skills/design-system/SKILL.md`:
  ```markdown
  ---
  name: design-system
  description: Use when the designer defines or changes theme tokens, colors, spacing, typography, or shared components.
  ---

  Keep one source of truth for Kiko styles.

  Rules:
  - Define tokens in a single theme module. Components read tokens; they do not hardcode values.
  - When a Figma file is provided, use the figma plugin skills to pull the design.
  - The developer consumes the design system. The designer owns it.
  ```
- [ ] Write `skills/retrospect/SKILL.md`:
  ```markdown
  ---
  name: retrospect
  description: Use at the end of a run to gather durable lessons and hand them to the scribe.
  ---

  Gather short, specific lessons after each run.

  Rules:
  - Record what worked, what failed, and the change to make next time.
  - Hand each lesson to the scribe to persist. Do not edit the plugin yourself.
  ```
- [ ] Write `skills/ops/SKILL.md`:
  ```markdown
  ---
  name: ops
  description: Use when running Kiko builds, installs, pods, or the harness checks.
  ---

  Run project commands and report results.

  Rules:
  - Report the exact command, its output, and the result.
  - Use the check scripts from plan #2: check:lint, check:all, check:deep.
  - Do not write app code. Hand code changes to the developer.
  ```

**Verification:**

- [ ] Each SKILL.md parses and appears in the skill list once the plugin is registered.

**Commit:**

- [ ] `git add -A && git commit -m "feat(plugin): add project workflow skills wrapping superpowers"`

---

## Task 6 — Harden the check wrappers

**Dependency:** This task depends on plan #2 being merged first. It edits the wrapper scripts in `scripts/checks/` that plan #2 created. This plan runs in a worktree branched from `main`, so those files exist there. Do not start this task until plan #2 is on `main`.

This task fixes two real defects found after plan #2 merged: a wrapper reported a false "duplication" finding when the real cause was a tool-execution failure, and the medium tier ran project-wide even when nothing changed.

**Files:**

- Edits `scripts/checks/lint.sh`, `dup.sh`, `knip.sh`, `deps.sh`, `security.sh`, `secrets.sh`, `mutation.sh` (Refinement A).
- Edits `scripts/checks/medium.sh` and `override-guard.sh` (Refinement B).

### Refinement A — wrapper robustness (never mislabel a tool failure as a finding)

Every tool wrapper must resolve its tool from `node_modules/.bin` (or `npx --no-install`). If the tool is not found, the wrapper prints a DISTINCT block whose WHAT line says the tool is not installed and whose HOW TO FIX says to run `npm install`, then exits 2. The WHAT line must reflect the real failure. It must never say "duplication" when the cause is a missing package.

- [ ] Edit each tool wrapper to add the not-installed guard. Worked example — the full hardened `scripts/checks/dup.sh` (it must not auto-fetch `jscpd@5`):
  ```bash
  #!/usr/bin/env bash
  set -uo pipefail
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$DIR/_lib.sh"
  ROOT="$(cd "$DIR/../.." && pwd)"
  BIN="$ROOT/node_modules/.bin/jscpd"

  if [ ! -x "$BIN" ]; then
    print_block \
      "jscpd (copy/paste detection)" \
      "The jscpd tool is not installed in node_modules." \
      "$BIN was not found or is not executable." \
      "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
      "Run: npm install   then re-run: npm run check:dup" \
      "Do not run jscpd through npx without --no-install (that auto-fetches jscpd@5 from the network). Install the pinned version with npm install."
    exit 2
  fi

  # Scope: paths passed as args (changed-files scope), else the whole repo.
  paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(".")
  out="$("$BIN" "${paths[@]}" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    print_block \
      "jscpd (copy/paste detection)" \
      "jscpd found duplicated code above the configured threshold." \
      "$out" \
      "Duplicated blocks are a common LLM failure mode: copy-pasting instead of extracting a shared function. Duplication multiplies bug surface and drifts out of sync." \
      "Extract the shared block into one function or module and call it from both places. Re-run: npm run check:dup" \
      "Do not rename a variable to trick jscpd. Extract the shared block into one function."
    exit 2
  fi
  exit 0
  ```
- [ ] Apply the same not-installed guard to `lint.sh` (biome), `knip.sh` (knip), `deps.sh` (depcheck), `security.sh` (semgrep — resolve from PATH, guard with `command -v`), `secrets.sh` (gitleaks — guard with `command -v`), and `mutation.sh` (stryker). Each WHAT line names its own tool. Each HOW TO FIX says `npm install` (or, for the PATH tools semgrep and gitleaks, the documented install command).

### Refinement B — changed-files scope for the medium tier

The medium tier must stay silent when nothing changed (the coordinator case) and scope the file-level checks to the session's changed source files.

- [ ] Edit `scripts/checks/override-guard.sh` to accept optional path arguments. With no args it scans the repo; with args it scans only those paths.
- [ ] Replace `scripts/checks/medium.sh` with this body:
  ```bash
  #!/usr/bin/env bash
  set -uo pipefail
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "$DIR/../.." && pwd)"
  cd "$ROOT"

  # Session changed source files: tracked changes + untracked, filtered to source.
  mapfile -t changed < <(
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
      | grep -E '\.(ts|tsx|js)$' \
      | grep -vE '^(ios/|node_modules/)' \
      | sort -u
  )

  # No changed source file (the coordinator case): stay silent.
  if [ ${#changed[@]} -eq 0 ]; then
    exit 0
  fi

  # Changed-file scope: jscpd and override-guard on the changed files only.
  "$DIR/dup.sh" "${changed[@]}" || exit 2
  "$DIR/override-guard.sh" "${changed[@]}" || exit 2
  # Project-wide: knip and deps.
  "$DIR/knip.sh" || exit 2
  "$DIR/deps.sh" || exit 2
  exit 0
  ```

**Verification:**

- [ ] With no source change, `bash scripts/checks/medium.sh` exits 0 and prints nothing (the coordinator case).
- [ ] With a changed file that has a duplicate block, `medium.sh` fails with the jscpd finding block.
- [ ] With the tool uninstalled (temporarily move `node_modules/.bin/jscpd`), `dup.sh` reports "not installed", not "duplication", and its HOW TO FIX says `npm install`.

**Commit:**

- [ ] `git add -A && git commit -m "fix(harness): guard wrappers against tool-execution failure; scope medium tier to changed files"`

---

## Task 7 — Tier hooks in the plugin

**Dependency:** This task depends on plan #2 being merged first. The wrapper scripts in `scripts/checks/` must already exist. Do not start this task until plan #2 is on `main`.

**Files:**

- Adds `harness/kiko-harness/hooks/hooks.json`.
- Edits `.claude/settings.json` (removes the duplicate hook entries).

**Steps:**

- [ ] Write `harness/kiko-harness/hooks/hooks.json` using the confirmed exit-2-to-stderr contract:
  ```json
  {
    "hooks": {
      "PostToolUse": [
        {
          "matcher": "Edit|Write|MultiEdit",
          "hooks": [
            { "type": "command", "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/fast.sh", "timeout": 60 }
          ]
        }
      ],
      "Stop": [
        {
          "matcher": "*",
          "hooks": [
            { "type": "command", "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/medium.sh", "timeout": 300 }
          ]
        }
      ],
      "SubagentStop": [
        {
          "matcher": "*",
          "hooks": [
            { "type": "command", "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/medium.sh", "timeout": 300 }
          ]
        }
      ]
    }
  }
  ```
- [ ] Remove the duplicate `PostToolUse`, `Stop`, and `SubagentStop` entries from `.claude/settings.json` that plan #2 added, so the checks do not run twice.
- [ ] The plugin must be enabled for the project for these hooks to fire. Enable it (Task 8) and confirm.

**Verification:**

- [ ] Enable the plugin, then introduce a deliberate fast violation (an `any` in a `.ts` file). Confirm the block surfaces via the plugin's PostToolUse hook.
- [ ] Introduce a medium violation (an unused export). Confirm the block surfaces at Stop.
- [ ] Confirm the checks run once, not twice.

**Commit:**

- [ ] `git add -A && git commit -m "feat(plugin): move tier hooks into the plugin hooks.json"`

---

## Task 8 — Register and load the plugin

**Steps:**

- [ ] Register the local plugin for this project. Add it as a local marketplace and install it, or add it to the project plugin config:
  ```bash
  # From the repo root; exact command confirmed against the installed version in Task 1.
  claude plugin marketplace add ./harness
  claude plugin install kiko-harness@harness
  ```
  Note: these two commands depend on the marketplace manifest `harness/.claude-plugin/marketplace.json` created in Task 2. The exact command form is confirmed in Task 1.
- [ ] List the agents and skills and confirm all nine agents and the four project skills appear:
  ```bash
  claude plugin list
  ```

**Verification:**

- [ ] All nine agents are listed and dispatchable.
- [ ] Each agent reports its configured model when spawned.
- [ ] The four project skills are listed.

**Commit:**

- [ ] `git add -A && git commit -m "chore(plugin): register kiko-harness for the project"`

---

## Task 9 — CLAUDE.md and memory

**Files:**

- Appends to `CLAUDE.md`.
- Adds a project memory file.

**Steps:**

- [ ] Append a "Harness agents" section to `CLAUDE.md`. Document the nine agents, each with its model and effort, in a table. State the delegation rule: the coordinator never edits app files inline, splits complex work into Orca worktrees, and reports a gap when no agent fits. Document the ponytail isolation (reviewer only, no global hooks).
- [ ] Record the spawn command per agent, so the coordinator applies effort at launch. Example:
  ```
  developer:  claude --effort high   (model: opus)
  scribe:     claude --effort low    (model: sonnet)
  ops:        claude --effort low    (model: haiku)
  ```
- [ ] Add one line to the `CLAUDE.md` harness section: a fresh checkout must run `npm install` before the harness hooks work, because the check tools live in `node_modules`.
- [ ] Seed the memory directory with a project memory that records the harness design decisions and the ponytail isolation. Add its one-line pointer to `MEMORY.md`.

**Verification:**

- [ ] `CLAUDE.md` contains the agent table, the delegation rule, and the ponytail isolation note.
- [ ] The memory file and its `MEMORY.md` pointer exist.

**Commit:**

- [ ] `git add -A && git commit -m "docs(plugin): document agents, delegation, and ponytail isolation"`

---

## Task 10 — Full verification

**Steps:**

- [ ] Confirm all nine agents load with the correct model.
- [ ] Confirm the effort is applied via `--effort` at spawn. Document the coordinator's spawn command per agent.
- [ ] Confirm ponytail is isolated: no global hooks, no config markers, and the STE style is intact for every agent and the main session.
- [ ] Confirm superpowers is reused, not copied (the project skills point to superpowers; they do not duplicate it).
- [ ] Confirm the plugin hooks fire at the right tiers (fast via PostToolUse, medium via Stop).
- [ ] Confirm the delegation docs are in place in `CLAUDE.md`.

**Verification:**

- [ ] The final report lists each confirmation with evidence.

**Acceptance criteria satisfied (spec Section 12):**

- All nine agents exist with an assigned model and effort.
- Ponytail is isolated to the reviewer with no global hooks.
- The plugin loads.
- Superpowers stays integrated and is not copied.

---

## Done criteria

- [ ] The plugin at `harness/kiko-harness/` loads with all nine agents and the four project skills.
- [ ] Each agent has the model from the table and a recorded effort level.
- [ ] The reviewer runs the vendored ponytail 4.9.0 review; no ponytail hooks are registered anywhere.
- [ ] The STE output style and the other agents stay clean.
- [ ] The tier hooks live in the plugin; the duplicate entries in `.claude/settings.json` are removed.
- [ ] `CLAUDE.md` documents the agents, the delegation rule, and the ponytail isolation; a project memory records the design.
- [ ] All commits are on the worktree branch. Nothing is merged to `main`.
```