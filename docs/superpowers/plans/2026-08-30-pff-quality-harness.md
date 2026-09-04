# Plan: PFF quality harness (Biome-adapted, LLM-guarding)

## Metadata

- **Goal:** Install a Biome-adapted, LLM-guarding quality harness wired into Claude Code hooks, with descriptive, agent-oriented failure messages.
- **Tech stack:** Biome, jscpd, Knip, Stryker (Jest runner), depcheck, osv-scanner, Semgrep, gitleaks, Claude Code hooks. Package manager: npm.
- **Spec:** `docs/superpowers/specs/2026-08-30-pff-scaffold-and-harness-design.md` (Sections 4 and 5).
- **Setup file:** `~/Desktop/setup-llm-precommit-harness.md` (Phases 3, 3a, 4, 4a, 5, 6).
- **Scope:** This plan implements the quality harness only. It does not create the agent plugin (that is plan #3).
- **Status:** Not started.

## Branch isolation note

This plan runs inside an Orca worktree on its own branch. Every commit step commits to that branch only. The coordinator presents the branch to the user before any merge to `main`.

## Real scaffold facts (from inspection)

- React Native 0.87.1, React 19.2.3.
- TypeScript: `typescript ^6.0.3` (stable) and `@typescript/native-preview ^7.0.0-dev` (TS 7, run via `tsgo`). Both are installed. The typecheck config must account for both.
- No `src/` directory. `App.tsx` and `index.js` sit at the repo root. Tests live in `__tests__/App.test.tsx`.
- The scaffold shipped `.eslintrc.js`, `.prettierrc.js`, `eslint ^8.19.0`, `@react-native/eslint-config`, and `prettier 2.8.8`. Biome replaces these. This plan removes them.
- `jest.config.js` uses the `@react-native/jest-preset`.
- `.gitignore` already ignores `node_modules/`, `**/Pods/`, `build/`, `/coverage`, and `*.jsbundle`.
- Existing `package.json` scripts: `ios`, `lint` (eslint .), `start`, `test`.

## Confirmed Claude Code hook contract (Task 1 result)

Source: `https://code.claude.com/docs/en/hooks` (verified 2026-08-30; the old `docs.claude.com` path 301-redirects here).

- **PostToolUse.** The hook reads a JSON object on stdin. Key fields: `tool_name`, `tool_input.file_path`, `tool_output`, `cwd`. Exit 0 is silent (stdout goes to the debug log only). **Exit 2 shows the hook's stderr to Claude as feedback.** The tool already ran, so exit 2 does not block it. This is the feedback channel for the fast tier.
- **Stop / SubagentStop.** Exit 0 with plain-text stdout adds that text as context Claude sees. **Exit 2 blocks the stop and shows stderr to Claude as the blocking reason.** This is the feedback channel for the medium tier.
- **Settings shape.** `hooks` → event name → array of `{ "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": N } ] }`. The `matcher` filters by tool name for PostToolUse (for example `"Edit|Write|MultiEdit"`) and by agent type for SubagentStop. Use `${CLAUDE_PROJECT_DIR}` in the command path. An optional `if` field accepts permission-rule syntax such as `"Edit(*.ts)"`.

**Consequence for this plan:** every wrapper exits `2` on failure and prints the structured block to **stderr**. This reaches the agent on both PostToolUse and Stop.

## Global Constraints

- Biome replaces ESLint and Prettier. Keep every other tool.
- Fail loud. No `|| true`. No global auto-suppress. An ignore-list entry needs an inline justification.
- Override protocol: `// biome-ignore <rule>: OVERRIDE(...) <reason>`. A bare ignore without `OVERRIDE(...)` is itself a violation.
- Every check runs through a wrapper in `scripts/checks/` that prints the structured block on failure: WHAT FAILED / DETAILS / WHY IT MATTERS / HOW TO FIX / DO NOT. Passing output stays quiet.
- No git hooks. No CI. Leave commented, ready-to-enable stubs only.
- Security is scoped to a mobile client (spec Section 5): enable secrets, disabled-TLS, insecure-random-for-tokens, insecure local storage (AsyncStorage secrets), and WebView injection. Skip SQL, tenant, IaC, .NET, and Python rules.

---

## Task 1 — Confirm the live Claude Code hook API

Already done during planning. The confirmed contract is recorded above under "Confirmed Claude Code hook contract". Task 12 wires the hooks against that contract.

**Verification:**

- [ ] The contract section states the exit-2-to-stderr feedback path for PostToolUse and Stop. Confirmed.

---

## Task 2 — Biome (lint + format)

Install Biome. Remove ESLint and Prettier. Enable the LLM-relevant rules Biome supports.

**Files:**

- Adds `biome.json`.
- Removes `.eslintrc.js` and `.prettierrc.js`.
- Edits `package.json` (removes ESLint and Prettier dev dependencies, replaces the `lint` script).

**Interfaces:**

- `npx biome check <path>` exits non-zero on any lint or format violation.

**Steps:**

- [ ] Install Biome, pinned to v2:
  ```bash
  npm install -D --ignore-scripts @biomejs/biome@^2.2.0
  ```
- [ ] Remove ESLint and Prettier:
  ```bash
  npm uninstall eslint prettier @react-native/eslint-config
  rm -f .eslintrc.js .prettierrc.js
  ```
- [ ] Write `biome.json`:
  ```json
  {
    "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
    "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
    "files": {
      "includes": ["**", "!ios/**", "!vendor/**", "!coverage/**", "!**/*.jsbundle"]
    },
    "formatter": {
      "enabled": true,
      "indentStyle": "space",
      "indentWidth": 2,
      "lineWidth": 100
    },
    "javascript": {
      "formatter": {
        "quoteStyle": "single",
        "trailingCommas": "all",
        "arrowParentheses": "asNeeded"
      }
    },
    "linter": {
      "enabled": true,
      "rules": {
        "recommended": true,
        "suspicious": { "noExplicitAny": "error" },
        "correctness": {
          "noUnusedVariables": "error",
          "noUnusedImports": "error"
        },
        "complexity": {
          "noExcessiveCognitiveComplexity": {
            "level": "error",
            "options": { "maxAllowedComplexity": 15 }
          }
        }
      }
    }
  }
  ```
- [ ] Replace the `lint` script and add `check:lint` in `package.json`:
  ```json
  "lint": "biome check .",
  "check:lint": "bash scripts/checks/lint.sh"
  ```
- [ ] Format the existing source once to a clean baseline:
  ```bash
  npx biome check --write .
  ```

**Note:** Biome has no direct `max-lines`, `max-params`, or `max-lines-per-function` rule. jscpd, Knip, and the reviewer agent cover that gap. Do not add ESLint back to get those rules.

**Verification (deliberate violation):**

- [ ] Add an explicit `any` to `App.tsx`, for example `const x: any = 1;`.
- [ ] Run the check and confirm it fails:
  ```bash
  npm run check:lint   # expect: exit 2, structured block naming noExplicitAny
  ```
- [ ] Remove the `any`. Run again and confirm a silent pass:
  ```bash
  npm run check:lint   # expect: exit 0, no output
  ```

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add Biome, remove ESLint and Prettier"`

---

## Task 3 — jscpd (copy/paste detection)

**Files:**

- Adds `.jscpd.json`.
- Edits `package.json` (adds `check:dup`).

**Steps:**

- [ ] Install jscpd, pinned to v4:
  ```bash
  npm install -D --ignore-scripts jscpd@^4.0.5
  ```
- [ ] Write `.jscpd.json`:
  ```json
  {
    "threshold": 5,
    "minTokens": 50,
    "minLines": 5,
    "reporters": ["console", "threshold"],
    "gitignore": true,
    "absolute": true,
    "path": ["."],
    "ignore": [
      "**/node_modules/**",
      "ios/**",
      "vendor/**",
      "__tests__/**",
      "coverage/**",
      "**/*.jsbundle"
    ]
  }
  ```
- [ ] Add the script: `"check:dup": "bash scripts/checks/dup.sh"`.

**Verification (deliberate violation):**

- [ ] Create two files with an identical block of 6+ lines and 50+ tokens.
- [ ] Run `npm run check:dup` and confirm it fails with the structured block.
- [ ] Remove the duplicate and confirm a silent pass.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add jscpd duplicate detection"`

---

## Task 4 — Knip (unused files, exports, deps)

**Files:**

- Adds `knip.json`.
- Edits `package.json` (adds `check:knip`).

**Steps:**

- [ ] Install Knip, pinned to v5:
  ```bash
  npm install -D --ignore-scripts knip@^5.30.0
  ```
- [ ] Write `knip.json` with the real entry points:
  ```json
  {
    "$schema": "https://unpkg.com/knip@5/schema.json",
    "entry": ["index.js", "App.tsx", "__tests__/**/*.{test,spec}.{ts,tsx}"],
    "project": ["**/*.{ts,tsx,js}"],
    "ignore": ["ios/**", "vendor/**", "coverage/**"]
  }
  ```
- [ ] Add the script: `"check:knip": "bash scripts/checks/knip.sh"`.

**Verification (deliberate violation):**

- [ ] Add an exported function that nothing imports, for example `export const dead = () => 1;` in a new file `unused.ts`.
- [ ] Run `npm run check:knip` and confirm it flags the unused export.
- [ ] Remove the file and confirm a silent pass.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add Knip dead-code detection"`

---

## Task 5 — Stryker (mutation testing)

Stryker is heavy. Wire it into `check:deep` only. Do not put it on an automatic hook.

**Files:**

- Adds `stryker.conf.json`.
- Edits `package.json` (adds `check:mutation`).

**Steps:**

- [ ] Install Stryker and the Jest runner, pinned to v8:
  ```bash
  npm install -D --ignore-scripts @stryker-mutator/core@^8.7.0 @stryker-mutator/jest-runner@^8.7.0
  ```
- [ ] Write `stryker.conf.json`:
  ```json
  {
    "$schema": "https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/api/schema/stryker-core.json",
    "packageManager": "npm",
    "testRunner": "jest",
    "jest": { "projectType": "custom", "configFile": "jest.config.js" },
    "mutate": ["**/*.ts", "**/*.tsx", "!**/*.test.ts", "!**/*.test.tsx", "!__tests__/**", "!ios/**"],
    "incremental": true,
    "reporters": ["clear-text", "progress"],
    "thresholds": { "high": 80, "low": 60, "break": 60 },
    "coverageAnalysis": "perTest"
  }
  ```
- [ ] Add the script: `"check:mutation": "bash scripts/checks/mutation.sh"`.

**Note:** The scaffold has almost no source yet, so Stryker may report no mutants. Re-run this check as real source lands. The break threshold starts at 60. Ratchet it up over time.

**Verification (deliberate violation):**

- [ ] Add a small source function and a test that calls it but asserts nothing.
- [ ] Run `npm run check:mutation` and confirm a surviving mutant drops the score below 60 and fails.
- [ ] Add a real assertion and confirm the score passes.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add Stryker mutation testing (check:deep only)"`

---

## Task 6 — Dependency hygiene and supply-chain hardening

**Files:**

- Adds `scripts/checks/deps.sh` and `scripts/checks/osv.sh` (wrapper bodies in Task 9).
- Edits `package.json` (adds `check:deps`).
- May edit `.npmrc`.

**Steps:**

- [ ] Install depcheck, pinned to v1:
  ```bash
  npm install -D --ignore-scripts depcheck@^1.4.7
  ```
- [ ] Install osv-scanner for the heavy tier:
  ```bash
  brew install osv-scanner   # pins to the current Homebrew formula (2.x)
  osv-scanner --version
  ```
- [ ] Enable the dependency min-age rule. It needs npm 11.10 or later. The user approved this machine-wide npm upgrade:
  ```bash
  npm --version   # current: 10.9.3 — too old for minimumReleaseAge
  npm install -g npm@^11   # user-approved; this is a machine-wide change
  npm --version   # expect: 11.10 or later
  ```
- [ ] Write the rule into `.npmrc`, excluding first-party packages:
  ```
  # 7-day dependency min-age: refuse versions published less than 7 days ago.
  minimum-release-age=10080
  minimum-release-age-exclude[]=PFF
  ```
  - [ ] **Fallback:** If `npm@11` fails to install, stop and report; do not silently skip the min-age rule.
- [ ] Add the script: `"check:deps": "bash scripts/checks/deps.sh"`.

The `deps.sh` wrapper (Task 9) covers: unused and missing deps (depcheck), lockfile integrity (`npm ci --ignore-scripts --dry-run`), and a hallucinated/new-dependency flag (a `git diff` of the `dependencies` block in `package.json` since the last commit, surfaced for human confirmation).

**Install-script suppression note:** Every harness tool install above uses `--ignore-scripts`, so a compromised dev dependency cannot run a `postinstall`. Do NOT add `--ignore-scripts` to the app's normal install or to `pod install`; the React Native native install needs its scripts.

**Verification (deliberate violation):**

- [ ] Add an unused dependency and a fake (hallucinated) dependency to `package.json`.
- [ ] Run `npm run check:deps` and confirm depcheck flags the unused one and the diff flags the new one.
- [ ] Remove both and confirm a silent pass.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add dependency hygiene checks"`

---

## Task 7 — Semgrep (mobile security rules)

Enable only mobile-client rules. Split into Class A (hard-fail) and Class B (override-eligible).

**Files:**

- Adds `rules/semgrep-mobile.yml`.
- Edits `package.json` (adds `check:security`).

**Steps:**

- [ ] Install Semgrep, pinned to v1:
  ```bash
  pipx install "semgrep>=1.90,<2"   # or: brew install semgrep
  semgrep --version
  ```
- [ ] Write the versioned custom ruleset `rules/semgrep-mobile.yml`:
  ```yaml
  rules:
    # ---- Class A: deterministic hard-fail (severity ERROR) ----
    - id: pff-disabled-tls
      languages: [typescript, javascript]
      severity: ERROR
      message: >
        TLS certificate validation is disabled. An attacker on the network can
        read or modify the app's traffic. Enable validation. Do not ship this.
      patterns:
        - pattern-either:
            - pattern: rejectUnauthorized: false
    - id: pff-insecure-random-for-secrets
      languages: [typescript, javascript]
      severity: ERROR
      message: >
        Math.random is not cryptographically secure. Do not use it for tokens,
        keys, or secrets. Use a CSPRNG (react-native-get-random-values / crypto).
      patterns:
        - pattern-regex: (token|secret|key|nonce|otp)\s*=\s*.*Math\.random
    - id: pff-secret-in-asyncstorage
      languages: [typescript, javascript]
      severity: ERROR
      message: >
        Secrets must not be written to AsyncStorage; it is unencrypted. Use the
        iOS Keychain (react-native-keychain) for tokens and credentials.
      patterns:
        - pattern-either:
            - pattern: AsyncStorage.setItem($K, $TOKEN)
        - metavariable-regex:
            metavariable: $K
            regex: (?i).*(token|secret|password|credential).*
    # ---- Class B: override-eligible finding (severity WARNING) ----
    - id: pff-webview-injectedjs-dynamic
      languages: [typescript, javascript]
      severity: WARNING
      message: >
        WebView injectedJavaScript built from a variable can run attacker code
        in the web context. Confirm the input is constant or fully sanitized,
        or add an OVERRIDE noting why it is safe.
      patterns:
        - pattern: <WebView injectedJavaScript={$X} ... />
        - metavariable-pattern:
            metavariable: $X
            patterns:
              - pattern-not: "$X"
  ```
- [ ] Add the script: `"check:security": "bash scripts/checks/security.sh"`.

The `security.sh` wrapper (Task 9) runs:
```bash
semgrep --config p/typescript --config p/react --config p/secrets --config rules/semgrep-mobile.yml
```
It treats ERROR findings (Class A) as a hard-fail and WARNING findings (Class B) as override-eligible.

**Verification (deliberate violations):**

- [ ] Add `rejectUnauthorized: false` (Class A) and confirm a hard-fail.
- [ ] Add a WebView with a dynamic `injectedJavaScript` (Class B) and confirm it surfaces as an override-eligible finding, not a hard block.
- [ ] Remove both and confirm a silent pass.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add Semgrep mobile security rules"`

---

## Task 8 — gitleaks (secret scanning)

**Files:**

- Adds `.gitleaks.toml`.
- Edits `package.json` (adds `check:secrets`).

**Steps:**

- [ ] Install gitleaks, pinned to v8:
  ```bash
  brew install gitleaks   # v8.x
  gitleaks version
  ```
- [ ] Write `.gitleaks.toml` extending the default ruleset:
  ```toml
  [extend]
  useDefault = true

  [allowlist]
  description = "Ignore vendored and generated paths"
  paths = [
    '''ios/Pods/.*''',
    '''vendor/.*''',
    '''node_modules/.*''',
  ]
  ```
- [ ] Add the script: `"check:secrets": "bash scripts/checks/secrets.sh"`.

The `secrets.sh` wrapper (Task 9) runs `gitleaks detect --no-git --source . --config .gitleaks.toml` for the working tree, or scopes to the touched file on the fast tier.

**Verification (deliberate violation):**

- [ ] Add a hardcoded secret, for example `const AWS_KEY = "AKIA...";`.
- [ ] Run `npm run check:secrets` and confirm it fails with the structured block.
- [ ] Remove the secret and confirm a silent pass.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add gitleaks secret scanning"`

---

## Task 9 — Wrapper scripts and the error-message contract

Create `scripts/checks/` with a shared helper and one wrapper per check. Each wrapper prints the structured block on failure and stays quiet on success. Each `DO NOT` line names the specific evasion.

**Files:**

- Adds `scripts/checks/_lib.sh`, `lint.sh`, `dup.sh`, `knip.sh`, `deps.sh`, `osv.sh`, `security.sh`, `secrets.sh`, `mutation.sh`, `override-guard.sh`, `fast.sh`, `medium.sh`.

**Steps:**

- [ ] Write the shared helper `scripts/checks/_lib.sh`:
  ```bash
  #!/usr/bin/env bash
  # Shared helper for harness check wrappers. Prints the structured failure
  # block to stderr so a Claude Code hook (exit 2) feeds it back to the agent.

  print_block() {
    # $1 name  $2 what  $3 details  $4 why  $5 howto  $6 donot
    {
      printf '────────────────────────────────────────────────────────\n'
      printf '✖ CHECK FAILED: %s\n' "$1"
      printf '────────────────────────────────────────────────────────\n'
      printf 'WHAT FAILED:    %s\n' "$2"
      printf 'DETAILS:        %s\n' "$3"
      printf 'WHY IT MATTERS: %s\n' "$4"
      printf 'HOW TO FIX:     %s\n' "$5"
      printf 'DO NOT:         %s\n' "$6"
      printf '────────────────────────────────────────────────────────\n'
    } >&2
  }
  ```
- [ ] Write `scripts/checks/lint.sh` (full example; the other wrappers follow the same shape):
  ```bash
  #!/usr/bin/env bash
  set -uo pipefail
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$DIR/_lib.sh"
  TARGET="${1:-.}"

  out="$(npx --no-install biome check "$TARGET" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    print_block \
      "Biome (lint + format)" \
      "Biome found lint or format violations in $TARGET." \
      "$out" \
      "These are the code shapes an LLM over-produces: explicit any, unused symbols, and over-complex functions. They rot the codebase and hide bugs." \
      "Run: npx biome check --write $TARGET  then fix any remaining errors by hand. Re-run: npm run check:lint" \
      "Do not silence a rule with a bare // biome-ignore. Fix the code, or use // biome-ignore <rule>: OVERRIDE(...) <specific reason>."
    exit 2
  fi
  exit 0
  ```
- [ ] Write the remaining wrappers with the same structure. Each captures the tool output, and on failure calls `print_block` with real text and `exit 2`. The `DO NOT` line for each:
  - `dup.sh` — "Do not rename a variable to trick jscpd. Extract the shared block into one function."
  - `knip.sh` — "Do not add the export to an ignore list. Delete the unused export or file."
  - `deps.sh` — "Do not add the dependency to depcheck ignores. Remove the unused dep; confirm any new dep is real."
  - `security.sh` — "Do not add nosemgrep to pass. Fix the vulnerability; for a Class B finding, add an OVERRIDE(...) noting why it is safe."
  - `secrets.sh` — "Do not move the secret to a config file. Remove it and load it from the iOS Keychain or an env var at runtime."
  - `mutation.sh` — "Do not delete the failing mutant's test. Add a real assertion that fails when the code is wrong."
  - `override-guard.sh` — "Do not remove the guard. Add the OVERRIDE(...) reason to the biome-ignore line."
- [ ] Write `scripts/checks/fast.sh` for PostToolUse. It reads the hook JSON on stdin, extracts the file path, and runs the fast-tier checks on that file:
  ```bash
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
  ```
  This parse uses node, not jq, because node is always present in this project.
- [ ] Write `scripts/checks/medium.sh` for Stop / SubagentStop. It runs the medium tier over the session's changed files and the project, and exits 2 on any failure so the block reaches the agent:
  ```bash
  #!/usr/bin/env bash
  set -uo pipefail
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  "$DIR/dup.sh" || exit 2
  "$DIR/knip.sh" || exit 2
  "$DIR/deps.sh" || exit 2
  "$DIR/override-guard.sh" || exit 2
  exit 0
  ```
- [ ] Make the scripts executable:
  ```bash
  chmod +x scripts/checks/*.sh
  ```

**Verification:**

- [ ] Trigger one failure per wrapper and confirm the exact five-line block prints to stderr, and that passing runs are silent.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add wrapper scripts and the error-message contract"`

---

## Task 10 — npm check scripts

**Files:**

- Edits `package.json` `scripts`.

**Steps:**

- [ ] Add the full set of scripts:
  ```json
  "check:lint": "bash scripts/checks/lint.sh",
  "check:dup": "bash scripts/checks/dup.sh",
  "check:knip": "bash scripts/checks/knip.sh",
  "check:deps": "bash scripts/checks/deps.sh",
  "check:security": "bash scripts/checks/security.sh",
  "check:secrets": "bash scripts/checks/secrets.sh",
  "check:mutation": "bash scripts/checks/mutation.sh",
  "check:overrides": "bash scripts/checks/override-guard.sh",
  "check:all": "npm run check:lint && npm run check:dup && npm run check:knip && npm run check:deps && npm run check:security && npm run check:secrets && npm run check:overrides",
  "check:deep": "npm run check:mutation && bash scripts/checks/osv.sh"
  ```

**Verification:**

- [ ] `npm run check:all` runs the fast and medium checks and exits 0 on the clean tree.
- [ ] `npm run check:deep` runs Stryker and osv-scanner.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): add check:* npm scripts"`

---

## Task 11 — Override protocol enforcement

**Files:**

- Adds `scripts/checks/override-guard.sh` (referenced in Task 9).

**Steps:**

- [ ] Write `override-guard.sh` to flag any bare `biome-ignore` that lacks an `OVERRIDE(...)` justification:
  ```bash
  #!/usr/bin/env bash
  set -uo pipefail
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  source "$DIR/_lib.sh"
  hits="$(grep -rnE 'biome-ignore' \
    --include='*.ts' --include='*.tsx' --include='*.js' \
    --exclude-dir=node_modules --exclude-dir=ios --exclude-dir=vendor . \
    | grep -v 'OVERRIDE(' || true)"
  if [ -n "$hits" ]; then
    print_block \
      "Override guard" \
      "A biome-ignore has no OVERRIDE(...) justification." \
      "$hits" \
      "An unexplained suppression hides a real problem from the next reader and from review." \
      "Add the reason: // biome-ignore <rule>: OVERRIDE(...) <specific reason>. Re-run: npm run check:overrides" \
      "Do not delete the guard. Justify the override, or fix the code so the ignore is not needed."
    exit 2
  fi
  exit 0
  ```

**Verification:**

- [ ] Add a bare `// biome-ignore lint/suspicious/noExplicitAny` and confirm the guard flags it.
- [ ] Change it to `// biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the SDK types this as any` and confirm it passes.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): enforce OVERRIDE(...) override protocol"`

---

## Task 12 — Wire the Claude Code hooks

Wire the fast tier to PostToolUse and the medium tier to Stop and SubagentStop, using the confirmed contract.

**Files:**

- Adds or edits `.claude/settings.json`.

**Steps:**

- [ ] Add the hooks to `.claude/settings.json`:
  ```json
  {
    "hooks": {
      "PostToolUse": [
        {
          "matcher": "Edit|Write|MultiEdit",
          "hooks": [
            {
              "type": "command",
              "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/fast.sh",
              "timeout": 60
            }
          ]
        }
      ],
      "Stop": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/medium.sh",
              "timeout": 300
            }
          ]
        }
      ],
      "SubagentStop": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "bash ${CLAUDE_PROJECT_DIR}/scripts/checks/medium.sh",
              "timeout": 300
            }
          ]
        }
      ]
    }
  }
  ```

**Note:** Plan #3 may relocate these hooks into the plugin's `hooks/hooks.json`. If it does, remove the duplicate entries here to avoid running each check twice.

**Verification:**

- [ ] Edit a `.ts` file to add an `any`. Confirm the fast block surfaces right after the edit through PostToolUse.
- [ ] Introduce an unused export. Confirm the medium block surfaces at Stop, and that the block text reaches the agent.

**Commit:**

- [ ] `git add -A && git commit -m "feat(harness): wire Claude Code hooks (fast + medium tiers)"`

---

## Task 13 — CLAUDE.md harness section

**Files:**

- Creates or appends `CLAUDE.md`.

**Steps:**

- [ ] Document each check: the command, the threshold, and the tier.
- [ ] State the standing rule: fix the underlying issue; never weaken a check to get green.
- [ ] Document the `check:deep` checkpoint expectation: run it before declaring a feature done.
- [ ] Document the override protocol with one worked example:
  ```ts
  // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the vendor SDK returns an untyped payload here
  const raw: any = sdk.rawResponse();
  ```
- [ ] Add a commented, ready-to-enable git-hook stub and a CI stub (both disabled):
  ```bash
  # FUTURE (disabled): a pre-commit hook could run `npm run check:all`.
  # FUTURE (disabled): a CI job could run `npm run check:all` and `npm run check:deep` as required checks.
  ```

**Verification:**

- [ ] `CLAUDE.md` lists all checks, the override example, and the disabled stubs.

**Commit:**

- [ ] `git add -A && git commit -m "docs(harness): document checks and override protocol in CLAUDE.md"`

---

## Task 14 — Full Phase-6 verification

**Steps:**

- [ ] Run every deliberate violation from Tasks 2–8 and 11. Capture the structured failure output for each into the final report.
- [ ] Remove each violation and confirm a clean, silent pass on all tiers.
- [ ] Measure and record the PostToolUse runtime and the Stop runtime. They must be fast enough not to disrupt the session.
- [ ] List the spec Section 12 acceptance criteria this plan satisfies.

**Verification:**

- [ ] The report contains: sample failure output for each check, the measured PostToolUse and Stop runtimes, and the acceptance-criteria checklist.

**Commit:**

- [ ] `git add -A && git commit -m "test(harness): Phase-6 verification report"`

---

## Done criteria

- [ ] Biome replaces ESLint and Prettier; ESLint and Prettier configs are gone.
- [ ] jscpd, Knip, Stryker, dependency hygiene, Semgrep (mobile rules), and gitleaks all run at the right tier.
- [ ] Every check runs through a `scripts/checks/` wrapper that prints the structured block on failure and stays quiet on success.
- [ ] The fast tier reaches the agent via PostToolUse exit 2; the medium tier via Stop / SubagentStop exit 2.
- [ ] Class A security rules hard-fail; Class B rules are override-eligible.
- [ ] The `OVERRIDE(...)` protocol works: a justified override passes; a bare ignore is flagged.
- [ ] No check is silenced or `|| true`'d.
- [ ] No git hooks and no CI are installed; only disabled stubs remain.
- [ ] All commits are on the worktree branch. Nothing is merged to `main`.
