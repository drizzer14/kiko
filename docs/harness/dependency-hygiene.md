# Dependency hygiene

Both rules below live in `.npmrc`.

## Pin new installs to exact versions (`save-exact=true`)

`save-exact=true` pins every NEW dependency install to an exact version —
npm writes the resolved version to `package.json` with no `^`/`~` range.
When you add any new dependency, it is pinned exact automatically; you do
not need to pass `--save-exact` by hand.

This governs NEW installs only. The existing `^` ranges already in
`package.json` are **not** mass-converted to exact. Rewriting them would
re-resolve the dependency tree during the 1.0.0 App Store freeze, which
must not happen now.

## 7-day dependency minimum age (`min-release-age`)

`.npmrc` also enforces `min-release-age=7`: npm refuses any version
published less than 7 days ago (`Kiko` and `react-native` are excluded).
See the "Dependency hygiene" section of the root `CLAUDE.md` for the full
rationale and the npm-version requirement.
