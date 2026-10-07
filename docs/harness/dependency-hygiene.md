# Dependency hygiene

This is the single source of truth for dependency hygiene. The root
`CLAUDE.md` only points here.

## Pin new installs to exact versions (`save-exact=true`)

`save-exact=true` pins every NEW dependency install to an exact version —
npm writes the resolved version to `package.json` with no `^`/`~` range.
When you add any new dependency, it is pinned exact automatically; you do
not need to pass `--save-exact` by hand.

Every spec in `dependencies`, `devDependencies`, `optionalDependencies`,
`peerDependencies`, and `overrides` (at any nesting depth) must be the
EXACT version `package-lock.json` already resolves. `npm run check:deps`
mechanizes this going forward: `scripts/checks/deps-ranges.js` uses an
ALLOWLIST, not a denylist — a spec passes only when it matches exact
semver (`\d+\.\d+\.\d+` with an optional prerelease/build suffix), so a
spec shape the denylist never enumerated (a bare major/minor version, an
empty spec, a tag like `latest`, a git reference) still fails, and an
exact prerelease spec is never misjudged as a range merely because one of
its identifiers happens to contain a denylisted character. See
`__tests__/deps-ranges.test.ts` for its fixture coverage.

## 7-day dependency minimum age (`min-release-age`)

`.npmrc` enforces a 7-day dependency minimum age: npm refuses any
version published less than 7 days ago (`Kiko` and `react-native` are
excluded).

```
min-release-age=7
min-release-age-exclude[]=Kiko
min-release-age-exclude[]=react-native
```

Note for anyone editing this: the real npm 11 config keys are
`min-release-age` (a plain number of **days**) and
`min-release-age-exclude`. `minimum-release-age` /
`minimum-release-age-exclude[]` are **not** recognized keys — npm
silently warns "Unknown project config" and enforces nothing. This
was verified against the npm CLI's own config definitions and by
testing: a version published 2 days ago was blocked; a years-old
version installed normally.

This requires npm 11.10+. Global npm on this machine was upgraded
(user-approved) from 10.9.3 to 11.19.1 to enable it.

## osv-scanner CVE remediation

`check:deep`'s osv-scanner step previously failed on 6 known CVEs in
transitive dev dependencies pulled in by the React Native CLI
toolchain (`@babel/core`, `ajv`, `image-size`, `tmp`). Four had a
patched version available and are now remediated via the
`overrides` block in `package.json` (`@babel/core`, `ajv`, `tmp`);
two (in `image-size`) do not yet — see "Known dependency CVEs"
below. This is tracked, real risk, not a harness bug — do not
suppress it.

`check:deep`'s osv-scanner also flagged CVE GHSA-67mh-4wv8-2f99:
esbuild <0.25.0, pulled in transitively by drizzle-kit's deprecated
`@esbuild-kit/core-utils`. Same pattern as the other three: pinned
via the `overrides` block in `package.json`, to the exact version
(`0.25.12`) already resolved there.

A global override (`"esbuild": "^0.25.12"`) would also constrain
`tsx`'s own, unrelated transitive `esbuild` and make `npm ls --all`
report it invalid/unmet (`ELSPROBLEMS`) even though the resolved
version satisfies the CVE fix. The override is instead scoped to its
real target, `@esbuild-kit/core-utils` (the package whose own declared
range, `~0.18.20`, is the stale/vulnerable one the override exists to
fix):

```json
"overrides": {
  "@esbuild-kit/core-utils": {
    "esbuild": "0.25.12"
  }
}
```

`tsx`'s own `esbuild` (its own `~0.28.0` range, resolved to `0.28.2`) is
untouched by the override now, and `npm ls --all` exits clean.
`scripts/checks/deps.sh` runs `npm ls --all` on every pass, so a
regression back to an unscoped override fails `check:deps` immediately.

A `node_modules/node_modules` entry (a stray `ln -s` inside `node_modules`, or
a broken nested folder) gets its own `check:deps` block before the dedup skip,
because it loops the tree and makes `npm ls --all` report every package
missing. A link: `rm node_modules/node_modules`. A real folder: `npm ci`.
Never `rm -r node_modules`. Test: `__tests__/deps-npm-ls-failure.test.ts`.

`bash scripts/checks/osv.sh` also flagged `fast-uri` 3.1.6
(GHSA-58mr-gqgx-xq4g, GHSA-qw65-cvwx-89v3), a dev-only dependency
pulled in by the overridden `ajv` (via `@stryker-mutator/core`).
It is pinned to the fixed `3.1.8` through a nested override scoped
to `ajv`, the same scoping as the `esbuild` pin above. The `"."` key
keeps the `ajv` pin itself:

```json
"overrides": {
  "ajv": {
    ".": "8.18.0",
    "fast-uri": "3.1.8"
  }
}
```

To pin a transitive dependency under a package that is itself
overridden, turn the override into an object: `"."` carries the
package's own pin and the child key carries the transitive pin. A second
top-level key for the same package is not valid.

`bash scripts/checks/osv.sh` also flagged `joi` 17.13.6
(GHSA-6h2x-m376-mqjq, CVSS 7.5), a dev-only dependency pulled in by
`@react-native-community/cli` -> `@react-native-community/cli-config`
and `@react-native-community/cli-types`. Both parents request
`^17.2.1`, which accepts the fixed `17.13.7`, and no existing override
covers them, so it is pinned with a top-level override. A later advisory
(GHSA-wr44-6hxh-3jwq, CVSS 6.3) moved the same pin to `17.13.8`
(published 2026-09-11):

```json
"overrides": {
  "joi": "17.13.8"
}
```

`bash scripts/checks/osv.sh` also flagged `brace-expansion` on two major
lines (GHSA-qhr7-859c-m2p7, GHSA-q2hr-2g5m-vwhr, GHSA-6j4f-fj2g-mc7p),
all dev-only: 2.1.4 under `minimatch` 9.0.9 (`@stryker-mutator/core`),
8.0.7 (`babel-plugin-module-resolver` -> `glob` 9.3.5), and 7.4.9
(`depcheck`); 1.1.18 under `minimatch` 3.1.5 (`test-exclude` 6.0.0,
`test-exclude` -> `glob` 7.2.3, `depcheck` -> `multimatch` 5.0.0). Every
parent range (`^2.0.1`/`^2.0.2`, `^1.1.7`) accepts the fixed 2.1.7 and
1.1.21. One plain `brace-expansion` key cannot hold both lines, so each
line is pinned by a version-selector key; the key is a selector, only
the value is the pin, and the value stays exact:

```json
"overrides": {
  "brace-expansion@1": "1.1.21",
  "brace-expansion@2": "2.1.7"
}
```

`bash scripts/checks/osv.sh` also flagged `moment` 2.30.1
(GHSA-4p3w-j4w9-5jqw), pulled in only by `react-native-calendars`
1.1314.0. It is pinned to the fixed 2.31.0 with a top-level override.
`moment` has not been in the app bundle since `cbd18366`: `KikoCalendar`
imports `react-native-calendars/src/calendar` by its deep path, and that
static import graph reaches no `moment`, so this pin is defense in depth:

```json
"overrides": {
  "moment": "2.31.0"
}
```

`bash scripts/checks/osv.sh` also flagged `compression` 1.8.1
(GHSA-vc2v-76pw-4v95, CVSS 7.5) and `smol-toml` 1.8.0
(GHSA-r4xh-jqrq-34v2, CVSS 5.3), both dev-only. `compression` comes
through `react-native` -> `@react-native/community-cli-plugin` ->
`@react-native-community/cli` -> `cli-server-api` (the Metro dev server;
a `devOptional` lockfile entry, never in the app bundle); `smol-toml`
comes through `knip`. Both parent ranges (`^1.7.1`, `^1.5.2`) accept the
fixed versions, so each is pinned with a top-level override to the
smallest fixed release in the same major: `compression` 1.8.2 (published
2026-09-11) and `smol-toml` 1.9.0 (published 2026-09-22):

```json
"overrides": {
  "compression": "1.8.2",
  "smol-toml": "1.9.0"
}
```

`bash scripts/checks/osv.sh` also flagged `source-map-js` 1.2.1
(GHSA-68fv-2mgg-jv7q, CVSS 8.7), dev-only: it comes through `depcheck`
-> `@vue/compiler-sfc` (and that package's `@vue/compiler-core` and
`postcss`), and `npm ls source-map-js --all --omit=dev` is empty. The
parent ranges (`^1.2.x`) accept the fixed 1.2.2 (published 2026-09-30,
eligible under `min-release-age=7` from 2026-10-07), so it is pinned with
a top-level override. Drop the override once the parents resolve 1.2.2 or
later on their own:

```json
"overrides": {
  "source-map-js": "1.2.2"
}
```

## `.env` is public-only

`react-native-dotenv` inlines every `.env` value into the JS bundle at
build time, so anything placed there ships in plaintext to every device.
Only public, non-secret values (a public API URL, a feature flag) belong
in `.env`. Secrets live in the iOS Keychain (`react-native-keychain`),
never in `.env`, `.env.local`, the database, or a log.

`.env` is not tracked; only the public `.env.example` template is. The
`postinstall` step (`scripts/ensure-env.js`) copies `.env.example` to
`.env` automatically when `.env` is missing, so a fresh checkout,
worktree, or CI has a working `.env` with no manual step. When `.env`
already exists, it instead appends any key present in `.env.example`
but absent from `.env`, so a key added to the template later still
reaches an older checkout's `.env`. Either way it never overwrites an
existing key's value, so a hand-edited file or a `.env.local` override
survives `npm install`.

`.env.test` is a tracked, public-only variant of `.env`. `jest.config.js`
defaults `ENVFILE` to it, so a fresh checkout runs hermetic Jest tests; an
explicit `ENVFILE` still wins. See `documented-exceptions.md` for the full
justification.

## Known dependency CVEs

`check:deep` will continue to flag 2 `image-size` advisories
(GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) at version 1.2.1, a
transitive dev dependency of the React Native CLI toolchain. A fixed
`image-size` 2.x release now exists, but it cannot be pinned here yet:
metro's own 1.x release line uses the pre-fix `image-size` 1.x API, so
upgrading the transitive dependency alone breaks metro (tracked as
SEC-8). This is accepted debt, not a suppressed finding — do
not silence it. Re-run `bash scripts/checks/osv.sh` periodically (not
`npm run check:deep`: its mutation step runs first and can stop at the
mutation file cap before osv-scanner runs) and upgrade
`image-size` (via `overrides`) the moment a fixed version ships.

`check:deep` also flags `decode-uri-component` 0.2.2, advisory
GHSA-vcc3-ghjq-m6fr (CVSS 6.6), pulled transitively via
`@react-navigation/native` -> `@react-navigation/core` ->
`query-string` -> `decode-uri-component`. The fixed release (0.5.0)
is ESM-only and breaks `query-string@7.1.3` (CommonJS) and Jest, so
it cannot be pinned via `overrides` today. Accepted as tracked debt,
same class as the `image-size` CVEs above — do not suppress it;
re-check periodically and pin once `query-string` ships an
ESM-compatible or patched line.

`check:deep` also flags `braces` 3.0.3, advisory GHSA-vfj7-8cjw-p6xm /
CVE-2026-93687 (published 2026-09-18, severity high, 8.7): a
stack-exhaustion denial of service through deeply nested patterns. No
fixed version exists. It is installed only through `micromatch` under
`@jest/transform`, from `babel-jest` (a test tool), never in the app
bundle (`npm ls braces --all` shows that one path). Accepted as tracked
debt (user decision 2026-10-03), same class
as the `image-size` CVEs above — do not suppress it; re-check
periodically with `bash scripts/checks/osv.sh` and bump the moment a
fix ships. Last checked 2026-10-03.

`check:deep` also flags `sprintf-js` 1.0.3, advisory GHSA-hp3w-g68c-fv3c
(CVSS 6.9). No fixed version exists. It is dev-only: both paths run
through one `js-yaml` 3.15.2 -> `argparse` 1.0.10 -> `sprintf-js` chain,
reached from two parents, `depcheck` (`^3.14.1`) and `babel-jest` ->
`babel-plugin-istanbul` -> `@istanbuljs/load-nyc-config` (`^3.13.1`;
`npm ls` shows this one as "deduped", `npm explain sprintf-js` shows
both). Removing `depcheck` alone therefore does not clear the advisory.
`npm ls sprintf-js --all --omit=dev` is empty, so it is never in the app
bundle. Accepted as tracked debt (same class as the `braces` advisory
above) — do not suppress it; re-check periodically with
`bash scripts/checks/osv.sh` and bump the moment a fix ships. Last
checked 2026-10-06.
