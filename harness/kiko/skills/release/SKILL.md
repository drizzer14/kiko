---
name: release
description: Use when publishing a Kiko release — GitHub release tagging/notes and App Store archive prep and handoff.
---

Standing rules:
- Every GitHub release tag is `vX.Y.Z`. Versions follow semantic versioning.
- Release notes list ONLY user-facing changes. Never list internal changes.
- Never attach an app build to a GitHub release. App builds reach the
  App Store only by the user's manual upload.

Preconditions:
- On `main`.
- Clean tree (the harmless Xcode `TARGETED_DEVICE_FAMILY`/pbxproj
  normalization is allowed).
- `npm run check:all` is green.

Who does what: the coordinator drives Part A (steps 1-5), `kiko:ops`
does step 6, the user does step 8. The skill stops at step 8 — nobody
uploads to the App Store on the user's behalf.

## Part A — GitHub release (coordinator)

1. Pick the version. Show every commit since the last `vX.Y.Z` tag:
   `git describe --tags --match 'v*'` and
   `git log <lasttag>..HEAD --oneline`. Suggest the bump — a breaking
   change is major, a `feat` is minor, a `fix` is patch. The user
   confirms the final X.Y.Z.
2. Build the changelog. Collect `feat:` and `fix:` commits since the
   last tag. Drop internal scopes with a denylist: `chore`, `ci`,
   `build`, `test`, `docs`, `style`, `refactor`, `harness`, `deps`,
   `check`, and merge commits. Present the user-facing draft; the user
   trims it. This text becomes the release notes.
3. Sync the versions:
   - Set `MARKETING_VERSION = X.Y.Z` in ALL configs in
     `ios/Kiko.xcodeproj/project.pbxproj`.
   - Add 1 to `CURRENT_PROJECT_VERSION` (all configs).
   - Set `package.json` `"version"` to `X.Y.Z`.
   - Commit as `chore(release): vX.Y.Z`.
4. Tag and push: `git tag vX.Y.Z`, then
   `git push origin main --follow-tags`.
5. Publish:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"`.
   Attach NO files.

## Part B — App Store prep, then hand off

6. `kiko:ops` archives the Release / KikoDistribution configuration.
7. Verify the archive invariants:
   - `UIDeviceFamily` is `[1]` (iPhone only).
   - The distribution signing identity is used.
   - App Group `group.com.dmytro-vasylkivskyi.kiko` is present and the
     old `group.com.dmytro.pff` is absent.
   - `get-task-allow = false`.
8. Hand off. The skill stops here. The user uploads the archive and
   the screenshots through the Xcode Organizer. State plainly that
   this skill does not upload to the App Store.

## First release — running submission log

Part A's steps 4-5 (tag + publish) always wait for the App Store to
actually publish, never merely to be submitted — this two-phase
ordering (tag-less archive first, then tag+publish only after
publication) is the general rule for every release, not something
special about this one. `v1.0.0`, the first release, is simply the
first time it applies; these notes track its concrete state and are
UPDATED as each submission's outcome becomes known — this is a running
log, not a one-shot snapshot:

1. **Build 3 (1.0.0) — SUBMITTED.** Step 3's version-sync ran with
   `MARKETING_VERSION` going from `1.0` (build `2`) to
   `MARKETING_VERSION=1.0.0` (build `3`), and Part B's archive was
   produced from build `3`. **No git tag was created at this step** —
   step 4 (`git tag`) and step 5 (`gh release create`) were
   deliberately skipped, per the two-phase rule below.
2. **Builds 4-6 — incremental 1.0.0 hotfix builds**, each version-bumped
   and re-archived without a tag (same two-phase rule): build 4 the
   base 1.0.0 bump, build 5 a crypto sync-form visibility hotfix, build
   6 a cross-currency net-worth fix.
3. **Rejection 1 — build 6 rejected under Guideline 5.6** (Developer
   Code of Conduct: hidden features). Apple found the screenshot/demo
   subsystem and a conditional auth-bypass compiled into the shipping
   binary. Fixed by stripping the screenshot subsystem to direct `@env`
   literal guards (Metro dead-code-eliminates it from Release) —
   re-archived as **build 7 (still 1.0.0)**.
4. **Rejection 2 — build 7 rejected under Guideline 5.6 again.** A
   `kiko:auditor` sweep found the real cause: `SHOW_UNREADY_BANKS` only
   hid bunq/PrivatBank in the UI list while their full connect/sync
   client code still shipped in the bundle — the same hidden-feature
   pattern, this time in the bank-connect surface. Decision: ship
   `next` with EVERYTHING honest as one **1.0.0** release — Monobank
   connect only, PrivatBank/bunq/Starling connect code (not their
   statement-import parsers) removed entirely, `SHOW_UNREADY_BANKS`
   deleted rather than gated. See memory `release-5-6-audit-findings`
   and `guidelines-compliance-is-architecture-rule`.
5. **Next submission — PENDING.** `next`'s dev `pbxproj` currently
   carries `MARKETING_VERSION=1.1.0` / `CURRENT_PROJECT_VERSION=7` (a
   dev-only bump, not yet archived) — the next actual App Store archive
   resets `MARKETING_VERSION` back to `1.0.0` with a new build number,
   per the "ship everything as one honest 1.0.0" decision (see memory
   `versioning-convention` for the MARKETING_VERSION/CURRENT_PROJECT_VERSION
   split, and read the live `pbxproj` values directly rather than
   trusting a number copied here — they move with every archive). No
   `v1.0.0` git tag exists yet.

This two-phase ordering is the **general rule for every release, not
an exception for the first one**: Part A's steps 1-5 are written above
as one sequence, but steps 4-5 (tag + publish) always wait for the App
Store to actually publish the app, never merely for it to be
submitted, in review, or rejected. Step 3 (version sync + archive)
always runs first and always tag-less, even across multiple rejected
submissions. `v1.0.0` is simply the first release this ordering
applies to.
