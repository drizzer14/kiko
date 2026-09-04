# Kiko — Scaffold and Agent Harness Design

## 1. Title and overview

Project name: Kiko (Personal Finance Folder).

This spec covers two things. The first is a bare React Native application. The target is the latest iOS only. The language is TypeScript. The second is a coordinator-driven agent harness that runs the project work.

The specific product requirements come later. This spec does not define app features. It defines the scaffold and the harness only. A planner can turn this spec into tasks.

## 2. Two phases

The work has two phases.

**Phase 1 — bootstrap.** The harness agents do not exist yet. The coordinator dispatches built-in agents (general-purpose or fork) to do the bootstrap work. The coordinator runs complex or parallel bootstrap work inside separate Orca worktrees.

**Phase 2 — steady state.** The harness agents exist. The coordinator delegates all work to the harness agents. The coordinator never edits project files inline. If no agent fits a task, the coordinator reports the gap instead of doing the task itself.

In both phases, the coordinator splits complex or parallel work into separate Orca worktrees. The coordinator authors the design, spec, and plan documents directly, because those are coordinator artifacts.

## 3. Project scaffold

Steps:

1. Run `npx @react-native-community/cli init Kiko`. This creates a bare React Native app.
2. Init into a temporary directory first. Then move the files into the repository root. This preserves the existing `.git` and `.claude` directories.
3. Keep iOS only. Remove the `android/` directory. Remove the Android scripts from `package.json`.
4. Set up TypeScript. Try the TS 7 native preview first. Roll back to TS 5.x stable if Metro, Jest, or Biome break.

Environment notes:

- Ruby is 2.7.5. React Native prefers Ruby 3.1 or later. The ops agent resolves Ruby during scaffold.
- CocoaPods is 1.12.1. The ops agent confirms it works with the chosen React Native version.

## 4. Quality harness (Biome-adapted)

Follow the setup file at `~/Desktop/setup-llm-precommit-harness.md`. Swap ESLint for Biome. Keep the other tools. Verify the live Claude Code hook API before you wire any hook.

Heaviness tier matrix:

| Tier | Hook event | Checks | Scope |
|---|---|---|---|
| Fast | `PostToolUse` (Edit / Write) | Biome (lint + format), Semgrep (mobile rules), gitleaks | the touched file |
| Medium | `Stop` / `SubagentStop` | jscpd, Knip, dependency hygiene | changed files + project |
| Heavy | `check:deep` script | Stryker (Jest mutation), osv-scanner audit | affected files + project |

Rules:

- Every check runs through a wrapper script in `scripts/checks/`. On failure, the wrapper prints the exact structured block: WHAT FAILED, DETAILS, WHY IT MATTERS, HOW TO FIX, DO NOT. Passing output stays quiet.
- The override protocol uses Biome's form: `// biome-ignore <rule>: OVERRIDE(...) <reason>`. A bare ignore without an `OVERRIDE(...)` reason is itself a violation.
- No git hooks. No CI. Leave commented, ready-to-enable stubs and a note in `CLAUDE.md`.
- Document every check in `CLAUDE.md`: the command, the threshold, and the standing rule to fix the code rather than weaken the check.

npm check scripts to add:

- `check:lint` — Biome lint and format.
- `check:dup` — jscpd.
- `check:knip` — Knip.
- `check:deps` — dependency hygiene.
- `check:security` — Semgrep and the mobile security rules.
- `check:secrets` — gitleaks.
- `check:mutation` — Stryker.
- `check:all` — the aggregate of the fast and medium checks.
- `check:deep` — Stryker and osv-scanner.

## 5. Security layer scoping

The app is a mobile client. Enable only the rules that match a mobile-client surface:

- Secret scanning with gitleaks.
- Disabled TLS validation (for example `rejectUnauthorized: false`).
- Insecure randomness used for tokens or secrets.
- Insecure local storage (secrets written to AsyncStorage).
- WebView injection sinks (for example `injectedJavaScript` from untrusted input).

Skip these rules. Their surfaces do not exist here:

- SQL injection.
- Tenant isolation.
- Infrastructure as code (IaC).
- .NET rules.
- Python rules.

## 6. The nine agents

Each agent gets its own model and thinking level to reflect its work.

| Agent | Model | Thinking | Role | Superpowers / skill links |
|---|---|---|---|---|
| explorer | sonnet | medium | Read-only search for context and code | dispatching-parallel-agents |
| debugger | opus | high | Runs debug steps, reports root cause, writes NO code | systematic-debugging |
| developer | opus | high | Writes all TypeScript and React Native code | test-driven-development, using-git-worktrees |
| reviewer | opus | high | Reviews diffs with vendored ponytail review and code-review | requesting-code-review |
| qa | sonnet | high | Writes Jest and React Native Testing Library tests, and Maestro iOS E2E tests | test-driven-development |
| retrospect | sonnet | medium | Gathers durable lessons after each run | (custom) |
| scribe | sonnet | low | Records into memory, skills, agents, and the plugin | writing-skills, skill-creator |
| ops | haiku | low | Runs project commands, scripts, and infrastructure | (custom) |
| designer | sonnet | high | Owns the in-app design system, theme tokens, colors, spacing, typography, and shared styled components | figma plugin skills, custom design-system skill |

Per-agent notes:

- **explorer.** The explorer searches the codebase and returns context. It reads excerpts, not whole files. It does not write code.
- **debugger.** The debugger runs the steps needed to reproduce and isolate a fault. It reports the root cause and a conclusion. It writes no code.
- **developer.** The developer writes all TypeScript and React Native code. It uses test-driven development. It works inside git worktrees.
- **reviewer.** The reviewer reviews diffs. It uses the vendored ponytail review and the built-in code-review skill.
- **qa.** The qa agent writes unit and component tests with Jest and React Native Testing Library. It writes iOS end-to-end tests with Maestro.
- **retrospect.** The retrospect agent gathers durable lessons after each run. It hands the lessons to the scribe.
- **scribe.** The scribe records lessons and facts into the memory directory, skills, agents, or the plugin.
- **ops.** The ops agent runs project commands and scripts. It owns the project infrastructure.
- **designer.** The designer owns the in-app design system: theme tokens, colors, spacing, typography, and shared styled components. The developer consumes the design system. The designer owns it.

The per-agent thinking-level mechanism must be verified against the live Claude Code agent frontmatter before the agent files are written.

## 7. Ponytail isolation

Do not install ponytail as a normal plugin.

Reason: ponytail registers global hooks — `SessionStart`, `SubagentStart`, and `UserPromptSubmit`. These hooks inject its persona into every session and every subagent. The `SubagentStart` hook would hit all nine agents. Ponytail also writes marker files into the Claude config directory and nudges a `statusLine` entry into `settings.json`.

Plan:

1. Vendor only the review logic into the reviewer agent. This is the review command plus the minimalism ruleset.
2. Pin the source version to 4.9.0.
3. Register no ponytail hooks. No `SessionStart`. No `SubagentStart`. No `UserPromptSubmit`.
4. Run the ponytail review only on demand, and only against a diff.
5. The scribe agent tracks the vendored version so we can update it.

Result: the reviewer gets ponytail. The STE output style, the coordinator session, and the other eight agents stay clean.

## 8. Plugin and skill packaging

Package the harness as a local plugin in the repository, for example `harness/kiko-harness/`. The plugin contains:

- `plugin.json` — the manifest.
- `agents/` — the nine agents.
- `skills/` — the project workflow skills.
- `commands/` — the project commands.
- `hooks/hooks.json` — the tier hooks from Section 4.

The project skills wrap the superpowers skills for our workflow. Reuse superpowers directly. Do not copy it. The scribe agent maintains this plugin over time.

## 9. Orca worktree strategy

The coordinator splits complex or parallel tasks into separate Orca worktrees with `orca-cli`. One agent runs one isolated task per worktree. The coordinator collects the results and integrates them. Small, single-file tasks stay in the main tree.

## 10. Memory and retrospection flow

After each run, the retrospect agent gathers durable lessons. The retrospect agent hands the lessons to the scribe agent. The scribe agent records them into the memory directory, a skill, an agent, or the plugin, whichever fits the lesson.

## 11. Open items and gaps

1. Biome has no direct `max-lines`, `max-params`, or `max-lines-per-function` rule. Rely on Biome cognitive-complexity, jscpd, Knip, and the ponytail reviewer to cover the same concern.
2. The 7-day dependency min-age rule needs npm 11.10 or later. The system npm is 10.9.3. The ops agent upgrades npm or documents the limit.
3. The per-agent thinking-level frontmatter must be verified against the live Claude Code docs.
4. The TS 7 preview may break the toolchain. Fall back to TS 5.x stable if it does.
5. Ruby 2.7.5 needs an upgrade for React Native iOS.
6. Locate the exact ponytail review command file at setup. The expected path returned HTTP 404.

## 12. Acceptance criteria

- The scaffold builds for iOS.
- Each harness check fires at its tier and emits the structured failure block.
- Ponytail is isolated to the reviewer, with no global hooks.
- All nine agents exist, each with its assigned model and thinking level.
- The plugin loads.
- Superpowers stays integrated and is not copied.
- No check is silenced or `|| true`'d to pass.
- No git hooks and no CI are installed. Only commented stubs remain.

## 13. Rollback

All changes go through config files and committed scripts. The clean rollback for the harness:

1. Remove the plugin directory (`harness/kiko-harness/`).
2. Remove `scripts/checks/`.
3. Remove the hook entries from the Claude settings.
4. Uninstall the pinned dev tools (Biome, jscpd, Knip, Stryker, Semgrep, gitleaks, osv-scanner).
