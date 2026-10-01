#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
PLIST="$ROOT/ios/Kiko/Info.plist"

problems=""
add_problem() { problems="${problems}
  - $1"; }

# --- 0. The plist must parse at all -------------------------------------------
if ! plutil -lint "$PLIST" >/dev/null 2>&1; then
  add_problem "$PLIST is not a valid property list ($(plutil -lint "$PLIST" 2>&1))"
fi

# --- 1. Every credential-bearing host must be pinned (H3) ---------------------
# A client that sends a credential header (X-Token, X-MBX-APIKEY, Authorization,
# or an api-key-ish header) or a credential query parameter (the bare word
# api_token, quoted or not: Biome unquotes an object key, and a template query
# string never quotes it) takes its base URL from `@env` — that is the
# project's convention (kiko-code-style, "Externalize hardcoded config"). Resolve
# each such client's `@env` identifiers to hosts via `.env`, then require every
# resolved host under NSPinnedDomains. This is what would have caught the
# unpinned Binance host on the day it landed.
pinned="$(plutil -extract NSAppTransportSecurity.NSPinnedDomains raw -o - "$PLIST" 2>/dev/null)"

while IFS= read -r file; do
  [ -n "$file" ] || continue
  # `@env` identifiers can be spread across multiple lines
  # (`import {\n  A,\n  B,\n} from '@env';`), so this parses with Node rather
  # than a single-line sed pattern. If the file references '@env' at all but
  # no identifier can be extracted, that is a parser/import-shape mismatch,
  # not "no credential endpoint here" — fail closed instead of silently
  # skipping the host check.
  if grep -qF '@env' "$file"; then
    env_names="$(PLIST_ENV_FILE="$file" node -e '
      const fs = require("fs");
      const src = fs.readFileSync(process.env.PLIST_ENV_FILE, "utf8");
      const re = /import\s*\{([^}]*)\}\s*from\s*\x27@env\x27;/gs;
      let m; const names = [];
      while ((m = re.exec(src))) {
        for (const raw of m[1].split(",")) { const t = raw.trim(); if (t) names.push(t); }
      }
      process.stdout.write(names.join("\n"));
    ')"
    if [ -z "$env_names" ]; then
      add_problem "${file#"$ROOT"/} references '@env' but plist.sh's parser could not extract an imported identifier from it (unrecognized import shape) — fix the import, or extend the parser, before this credential-bearing client's endpoint can be verified as pinned"
    fi
  else
    # Fail closed, the same way an unparsable import does: a client that sends a
    # credential (header or api_token) takes its base URL from `@env` by
    # convention, so with no `@env` import at all there is no host to resolve
    # and this check would silently prove nothing about the one file it most
    # needs to.
    add_problem "credential (header or 'api_token' query parameter) but no @env import in ${file#"$ROOT"/} — its endpoint cannot be resolved, so it cannot be verified as pinned; move the base URL into .env and import it from '@env'"
    env_names=""
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    raw_value="$(grep -E "^${name}=" "$ROOT/.env" | head -1 | cut -d= -f2-)"
    # Strip surrounding whitespace and quotes before the scheme test: `.env`
    # accepts `NAME="https://host"` and a trailing space, and either would make
    # the test below skip a real credential-bearing endpoint.
    value="$(printf '%s' "$raw_value" | sed -E -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
      -e 's/^"(.*)"$/\1/' -e "s/^'(.*)'\$/\1/")"
    case "$value" in http://*|https://*) ;; *) continue ;; esac
    host="$(printf '%s' "$value" | sed -E 's#^[a-z]+://##; s#[/?].*$##')"
    if ! printf '%s\n' "$pinned" | grep -Fxq "$host"; then
      add_problem "$host (from $name, used by ${file#"$ROOT"/}) sends a credential (header or 'api_token' query parameter) but is not under NSPinnedDomains in ios/Kiko/Info.plist"
    fi
  done <<EOF
$env_names
EOF
done <<EOF
$(grep -rlE "'(X-Token|X-MBX-APIKEY|Authorization)'|'[Aa]pi[-_]?[Kk]ey'|(^|[^A-Za-z0-9_])api_token([^A-Za-z0-9_]|$)" "$ROOT/src" --include='*.ts' | grep -v '\.test\.')
EOF

# Every pinned domain must carry at least two SPKI pins (reinforces Task 7/H3).
# A domain pinned with a single hash cannot survive a certificate rotation:
# the day that cert is replaced, the app can no longer reach the host at all
# until an app update ships. Two pins (root + intermediate, or current +
# backup) let a rotation happen without an outage.
thin_pins="$(plutil -convert json -o - "$PLIST" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{
    const j=JSON.parse(s);
    const domains=(j.NSAppTransportSecurity||{}).NSPinnedDomains||{};
    const bad=Object.keys(domains).filter(d=>{
      const ids=domains[d].NSPinnedCAIdentities;
      return !Array.isArray(ids) || ids.length<2;
    });
    process.stdout.write(bad.join(", "));
  }catch{process.stdout.write("")}
})')"
if [ -n "$thin_pins" ]; then
  add_problem "domain(s) with fewer than 2 NSPinnedCAIdentities entries in ios/Kiko/Info.plist: $thin_pins — a single pin cannot be rotated without an outage; add a backup pin"
fi

# --- 2. Release ATS hardening (H6) -------------------------------------------
arbitrary="$(plutil -extract NSAppTransportSecurity.NSAllowsArbitraryLoads raw -o - "$PLIST" 2>/dev/null)"
if [ "$arbitrary" != "false" ]; then
  add_problem "NSAppTransportSecurity.NSAllowsArbitraryLoads must be <false/> (found: '${arbitrary:-missing}')"
fi

# Absent from the SOURCE plist on purpose: it is a Metro convenience that must
# never ship in Release. The "Inject Debug-only ATS local networking" build
# phase adds it back for Debug builds only.
if plutil -extract NSAppTransportSecurity.NSAllowsLocalNetworking raw -o - "$PLIST" >/dev/null 2>&1; then
  add_problem "NSAppTransportSecurity.NSAllowsLocalNetworking is present in ios/Kiko/Info.plist; it must exist only in Debug builds, injected by the build phase"
fi

if ! grep -q 'Inject Debug-only ATS local networking' "$ROOT/ios/Kiko.xcodeproj/project.pbxproj"; then
  add_problem "the 'Inject Debug-only ATS local networking' build phase is missing from ios/Kiko.xcodeproj/project.pbxproj; Debug builds cannot reach Metro without it, and removing it invites putting NSAllowsLocalNetworking back into the shipped plist"
fi

# --- 3. No empty purpose string (H6) -----------------------------------------
# An empty NS*UsageDescription advertises a capability with no stated reason and
# is a known App Store review rejection trigger.
empty_purposes="$(plutil -convert json -o - "$PLIST" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{
    const j=JSON.parse(s);
    const bad=Object.keys(j).filter(k=>/^NS.*UsageDescription$/.test(k) && String(j[k]).trim()==="");
    process.stdout.write(bad.join(", "));
  }catch{process.stdout.write("")}
})')"
if [ -n "$empty_purposes" ]; then
  add_problem "empty NS*UsageDescription key(s) in ios/Kiko/Info.plist: $empty_purposes — delete the key, or give it a real purpose string and record why in docs/security/README.md"
fi

# --- 4. The home-screen name is localized -------------------------------------
# iOS takes the name under the icon from <language>.lproj/InfoPlist.strings and
# falls back to Info.plist's CFBundleDisplayName, so a table that is missing,
# wrong, or never copied into the bundle shows one language's name to everyone.
project_file="$ROOT/ios/Kiko.xcodeproj/project.pbxproj"
for language_name in "en:Kiko" "uk:Кіко"; do
  language="${language_name%%:*}"
  expected_name="${language_name#*:}"
  name_table="ios/Kiko/$language.lproj/InfoPlist.strings"
  actual_name="$(plutil -extract CFBundleDisplayName raw -o - "$ROOT/$name_table" 2>/dev/null)"
  if [ "$actual_name" != "$expected_name" ]; then
    add_problem "$name_table must set CFBundleDisplayName to \"$expected_name\" (found: '${actual_name:-missing}')"
  fi
  if ! grep -qF "path = Kiko/$language.lproj/InfoPlist.strings;" "$project_file"; then
    add_problem "ios/Kiko.xcodeproj/project.pbxproj does not reference $name_table, so the build never copies it into the app"
  fi
done
# The PBXBuildFile line also reads "InfoPlist.strings in Resources", so only an
# entry inside the Resources build phase section proves the build copies it.
resources_phase="$(awk '/Begin PBXResourcesBuildPhase section/,/End PBXResourcesBuildPhase section/' "$project_file" 2>/dev/null)"
if ! printf '%s\n' "$resources_phase" | grep -qF '/* InfoPlist.strings in Resources */'; then
  add_problem "InfoPlist.strings is not in the Kiko target's Resources build phase in ios/Kiko.xcodeproj/project.pbxproj"
fi

# --- 5. Every linked disk-space API is declared ------------------------------
# App Store Connect scans the binary's symbols, not the call sites, and no pod
# below ships a privacy manifest that covers DiskSpace, so an upload without
# this entry draws ITMS-91053. Each dependency here links a required-reason
# disk-space API:
#   - react-native-fs: RNFSManager reads NSFileSystemFreeSize/NSFileSystemSize.
#   - @op-engineering/op-sqlite: its bundled SQLite, SQLCipher build included
#     (cpp/sqlcipher/sqlite3.c, cpp/sqlite3.c), calls fstatfs under
#     `defined(__APPLE__)`, which SQLITE_ENABLE_LOCKING_STYLE=0 does not remove.
privacy_manifest="$ROOT/ios/Kiko/PrivacyInfo.xcprivacy"
# The answer is "none" or the linked sources; anything else (node missing or
# failing, package.json unreadable) is empty and fails closed: an empty answer
# must not pass as "nothing ships".
disk_space_sources="$(node -e '
  const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const dependencies = manifest.dependencies || {};
  const linked = ["react-native-fs", "@op-engineering/op-sqlite"].filter((name) => dependencies[name]);
  process.stdout.write(linked.length > 0 ? linked.join(", ") : "none");
' "$ROOT/package.json" 2>/dev/null)"
if [ -z "$disk_space_sources" ]; then
  add_problem "plist.sh could not tell from package.json whether a disk-space API user (react-native-fs, @op-engineering/op-sqlite) ships: node failed or package.json is unreadable"
elif [ "$disk_space_sources" != "none" ]; then
  disk_space_reasons="$(plutil -convert json -o - "$privacy_manifest" 2>/dev/null | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk)).on("end", () => {
    try {
      const accessedTypes = JSON.parse(input).NSPrivacyAccessedAPITypes || [];
      const entry = accessedTypes.find(
        (accessedType) => accessedType.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryDiskSpace",
      );
      process.stdout.write(((entry && entry.NSPrivacyAccessedAPITypeReasons) || []).join(", "));
    } catch {
      process.stdout.write("");
    }
  });
')"
  if [ -z "$disk_space_reasons" ]; then
    add_problem "$disk_space_sources links a disk-space API, but ios/Kiko/PrivacyInfo.xcprivacy declares no NSPrivacyAccessedAPICategoryDiskSpace reason"
  fi
fi

if [ -n "$problems" ]; then
  print_block \
    "iOS Info.plist assertions" \
    "The shipped Info.plist, its localized name tables, or the privacy manifest do not satisfy the project's invariants." \
    "$problems" \
    "The plist is the app's ATS, pinning, and privacy-declaration policy. An unpinned credential-bearing host can be MITM'd by any device-trusted CA (an MDM or coerced configuration profile), which reads the credential and the response; a single-pin domain cannot survive a certificate rotation without an outage; NSAllowsLocalNetworking in a Release build exempts .local/loopback from ATS in the shipped binary; an empty NS*UsageDescription is an App Store review rejection trigger; a missing or unwired InfoPlist.strings shows one language's home-screen name to every user; an undeclared required-reason API draws ITMS-91053 on upload. See docs/security/README.md." \
    "Fix ios/Kiko/Info.plist, ios/Kiko/<language>.lproj/InfoPlist.strings and its project wiring, or ios/Kiko/PrivacyInfo.xcprivacy (and docs/security/README.md's host table). Re-run: npm run check:plist" \
    "Do not delete the assertion or add the host to an ignore list. Pin the host, or stop sending it a credential; keep a required-reason entry while the dependency that links the API ships."
  exit 2
fi

exit 0
