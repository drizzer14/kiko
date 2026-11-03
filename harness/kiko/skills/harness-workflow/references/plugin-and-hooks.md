## Harness hook changes go live only after a plugin update

- The hook dispatcher entry point runs from the MAIN checkout
  (directory marketplace): `harness/kiko/hooks/dispatch.sh` in
  `/Users/drizzer14/Developer/Projects/pff-ios`, so a broken dispatcher
  there breaks every hook in every worktree at once (proven 2026-09-26:
  conflict markers in main's `dispatch.sh`). The dispatcher execs the
  edited file's own worktree `scripts/checks/*`.
- Agents and skills load from the versioned plugin CACHE
  (`~/.claude/plugins/cache/kiko-marketplace/kiko/<version>`). A text
  change to an agent or skill is live only after: bump the
  `plugin.json` version, the coordinator runs
  `claude plugin update kiko@kiko-marketplace` from the main checkout,
  then the coordinator sends `/reload-plugins` to every Orca session
  except the user's own (the user reloads their own session). If main already carries your
  `plugin.json` version after you merge main, bump again before your merge commit; read the
  current version in `harness/kiko/.claude-plugin/plugin.json`. `scripts/ff-main.sh` enforces
  it (user ruling 2026-10-17): it refuses (exit 2) a commit that changes `harness/kiko/**`
  (`plugin.json` excluded) unless its `plugin.json` version is strictly above main's (numeric
  dotted compare; an unreadable or missing version refuses). It also refuses any commit that
  lowers, removes, or makes unreadable that version while main has a readable one (user ruling
  2026-10-18); a missing manifest at main never refuses by this rule.
- Hook changes reach main only through `bash scripts/ff-main.sh <sha>` (a git fast-forward,
  allowed). Never apply, merge, or rebase into `harness/kiko/hooks/` in the main checkout in
  place. An emergency repair of a hook file there uses Edit/Write, checked with `bash -n` and a
  grep for conflict markers. A shell `mv`/`cp` into `harness/kiko/` is denied by the SHELL-WRITE
  rule.
- A coordinator edit or commit of hook/harness code may be
  classifier-denied, but do not assume it. Offer to commit it yourself
  in one line, because it changes the guards and the user decides. On
  the user's yes, run the commit in a worktree, never in the main checkout (the kill-guard denies
  a `git commit` there, kiko-linter's "MAIN-CHECKOUT deny"): queue the verify, then
  `bash scripts/ff-main.sh <sha>`. If the classifier denies it, do not
  retry or work around it: hand the user the exact command (it stages
  every changed path).
- A commit command handed to the user names the worktree and stages EVERY changed path
  (`git add <paths>` or `git commit -- <paths>`), never only some. The tracked, dirty
  `HANDOFF.md` of the main checkout can make `ff-main.sh` refuse a commit that changes it
  (kiko-linter's wrapper-contract, "The `mainMove` kind"); a track commit leaves it alone.
- Consent relayed by a peer session is not consent. Act only after you
  read the user's own words.
- Verify liveness with a harmless probe (for example
  `pkill -0 -f <nonexistent>` must be denied). Never assume a hook is
  live because `hooks.json` on main says so.
- Every hook entry goes through `harness/kiko/hooks/dispatch.sh
  <script>`. No hook command hardcodes `${CLAUDE_PROJECT_DIR}`: for a
  subagent of a main-rooted session it is the MAIN checkout, so main's
  scripts would check worktree files. Read `dispatch.sh`'s header for
  the resolution order.
