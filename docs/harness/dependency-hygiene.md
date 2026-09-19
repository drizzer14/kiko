# Dependency hygiene

This is the single source of truth for dependency hygiene. The root
`CLAUDE.md` only points here.

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
via the `overrides` block in `package.json` to `^0.25.12`.

## `.env` is public-only

`react-native-dotenv` inlines every `.env` value into the JS bundle at
build time, so anything placed there ships in plaintext to every device.
Only public, non-secret values (a public API URL, a feature flag) belong
in `.env`. Secrets live in the iOS Keychain (`react-native-keychain`),
never in `.env`, `.env.local`, the database, or a log.

`.env` is not tracked; only the public `.env.example` template is. The
`postinstall` step (`scripts/ensure-env.js`) copies `.env.example` to
`.env` automatically when `.env` is missing, so a fresh checkout,
worktree, or CI has a working `.env` with no manual step. It never
overwrites an existing `.env`, so a hand-edited file or a `.env.local`
override survives `npm install`.

`.env.test` is a tracked, public-only variant of `.env`. `jest.config.js`
defaults `ENVFILE` to it, so a fresh checkout runs hermetic Jest tests; an
explicit `ENVFILE` still wins. See `documented-exceptions.md` for the full
justification.

## Known dependency CVEs

`check:deep` will continue to flag 2 `image-size` advisories
(GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) at version 1.2.1, a
transitive dev dependency of the React Native CLI toolchain. No
patched release exists upstream yet, so there is nothing to pin via
`overrides`. This is accepted debt, not a suppressed finding — do
not silence it. Re-run `npm run check:deep` periodically and upgrade
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
