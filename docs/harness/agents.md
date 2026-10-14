# Harness agents (detail)

> Authoritative; edit it here. CLAUDE.md names the agents and points here.

### The thirteen agents

| Agent | Role | model | effort | Spawn command |
|---|---|---|---|---|
| developer | Writes all TypeScript/React Native code | sonnet | high | `claude --agent developer --effort high` |
| planner | Writes implementation plans from a spec or feature request | opus | medium | `claude --agent planner --effort medium` |
| debugger | Isolates faults, writes no code | sonnet | high | `claude --agent debugger --effort high` |
| reviewer | Reviews diffs: correctness, project conventions, App Store compliance (`kiko-compliance` skill), then ponytail over-engineering findings | opus | high | `claude --agent reviewer --effort high` |
| qa | Writes Jest/RNTL unit tests and Maestro E2E flows | sonnet | medium | `claude --agent qa --effort medium` |
| designer | Owns theme tokens and shared styled components | sonnet | medium | `claude --agent designer --effort medium` |
| explorer | Read-only codebase search | sonnet | low | `claude --agent explorer --effort low` |
| retrospect | Gathers durable lessons after a run | sonnet | medium | `claude --agent retrospect --effort medium` |
| scribe | Persists durable knowledge (memory, skills, agents, plugin) | sonnet | low | `claude --agent scribe --effort low` |
| ops | Runs builds, installs, pods, and the harness checks | sonnet | low | `claude --agent ops --effort low` |
| pm | Reports the live task board, branches, and worktrees from Orca and git; verifies narrative docs and flags drift | sonnet | low | `claude --agent pm --effort low` |
| auditor | Read-only whole-codebase audit (security, performance, bundle, dependencies); reports ranked findings, writes no code | sonnet | medium | `claude --agent auditor --effort medium` |
| researcher | Read-only web research and live API probes; returns findings with source URL + check date per claim | sonnet | medium | `claude --agent researcher --effort medium` |

Agent frontmatter sets both `model` and `effort`; the Agent tool
applies both on dispatch. Passing `--effort` at spawn time is only
needed for a standalone `claude --agent` session, and must match the
frontmatter, per the table above.

### Ponytail isolation

The reviewer's `/ponytail-review` command vendors only the review
prompt from ponytail 4.9.0 (`harness/kiko/commands/ponytail-review.md`).
No ponytail hooks are registered anywhere (no `SessionStart`,
`SubagentStart`, or `UserPromptSubmit` from ponytail). The ponytail
persona applies only inside that command's own output; the STE style
and every other agent's output stay unaffected.

### Superpowers

The plugin does not copy superpowers. Its skills (the folders under
`harness/kiko/skills/`) and its agents point at superpowers skills directly
(`superpowers:test-driven-development`, `superpowers:systematic-debugging`,
`superpowers:using-git-worktrees`, `superpowers:requesting-code-review`,
`superpowers:writing-skills`, `superpowers:dispatching-parallel-agents`,
`superpowers:brainstorming`, `superpowers:writing-plans`,
`superpowers:executing-plans`, `superpowers:subagent-driven-development`,
`superpowers:verification-before-completion`,
`superpowers:finishing-a-development-branch`), reusing the installed
`superpowers` plugin rather than duplicating any of its content.
