#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

fail() {
  # $1 details
  print_block \
    "Component i18n namespace" \
    "A file under src/design-system/components/<name>/ reads another component's i18n namespace." \
    "$1" \
    "kiko-translator's 'A string moved into a shared component changes namespace' rule: a shared design-system component reads only components.<camelCase(folder name)>.*. A sibling's keys change or go away with that sibling's copy, and the reader then renders a bare key path." \
    "Move the key to the component's own components.<name>.* namespace in src/i18n/locales/en.ts and uk.ts in the same commit, then read it from there. Re-run: npm run check:component-i18n-namespace" \
    "Do not copy the namespace check into an exemption list, and do not keep the old key beside the new one."
  exit 2
}

# Project-wide only (npm run check:component-i18n-namespace): every .ts/.tsx under
# src/design-system/components. The pre-write guard spawns component-i18n-namespace.js itself, so
# there is no per-file mode. COMPONENT_I18N_NAMESPACE_SOURCE_ROOT overrides the scanned root with
# one directory, used only by __tests__/component-i18n-namespace.test.ts to point this mode at a
# disposable temp tree; dedup is skipped in that case, since the code fingerprint below reads the
# real repo's git state, not the temp tree's content.
root="${COMPONENT_I18N_NAMESPACE_SOURCE_ROOT:-$ROOT/src/design-system/components}"
if [ -z "${COMPONENT_I18N_NAMESPACE_SOURCE_ROOT:-}" ]; then
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "component-i18n-namespace" "$fp"; then
    exit 0
  fi
fi

# A moved or renamed components folder would otherwise leave the check passing on an empty scan.
if [ ! -d "$root" ]; then
  print_block \
    "Component i18n namespace" \
    "The directory this check scans does not exist, so nothing was checked." \
    "$root" \
    "A check that finds no files to scan passes silently, so a moved or renamed src/design-system/components would switch the namespace rule off without a trace." \
    "Point the check at the real folder: update scripts/checks/component-i18n-namespace.sh and COMPONENT_FOLDER in component-i18n-namespace.js to the new location. Re-run: npm run check:component-i18n-namespace" \
    "Do not create an empty folder to make the check pass."
  exit 2
fi

files=()
while IFS= read -r file; do
  [ -n "$file" ] && files+=("$file")
done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/component-i18n-namespace.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${COMPONENT_I18N_NAMESPACE_SOURCE_ROOT:-}" ] || harness_mark_pass "$ROOT" "component-i18n-namespace" "$fp"
exit 0
