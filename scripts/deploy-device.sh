#!/bin/bash
set -euo pipefail

# Build Release-AdHoc, check the bundle, install, and launch on an iPhone.
# EXPECT_BUNDLE_STRING (or `make deploy EXPECT=<str>`): a string the built
# main.jsbundle must contain, checked before install by
# scripts/bundle-contains.js (UTF-8, plus UTF-16LE for non-ASCII). Unset:
# the check is skipped with one line. A value that contains a single quote
# is not supported through `make deploy`. The launch is retried once.

# Resolve repo root from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
WORKSPACE="$REPO_ROOT/ios/Kiko.xcworkspace"
SCHEME="Kiko"
CONFIGURATION="Release-AdHoc"
SDK="iphoneos"
DERIVED_DATA="$REPO_ROOT/ios/build"
APP_PATH="$DERIVED_DATA/Build/Products/Release-AdHoc-iphoneos/Kiko.app"
BUNDLE_ID="com.dmytro-vasylkivskyi.kiko"

# Resolve device ID with priority: (1) CLI arg, (2) DEVICE_ID env var, (3) auto-detect
# Capture incoming DEVICE_ID env var before resetting it
DEVICE_ID_FROM_ENV="${DEVICE_ID:-}"

# Initialize internal DEVICE_ID variable
DEVICE_ID=""

# First: check CLI argument
if [[ $# -gt 0 ]]; then
  DEVICE_ID="$1"
fi

# Second: check environment variable
if [[ -z "$DEVICE_ID" && -n "$DEVICE_ID_FROM_ENV" ]]; then
  DEVICE_ID="$DEVICE_ID_FROM_ENV"
fi

# Third: auto-detect connected physical iPhone
if [[ -z "$DEVICE_ID" ]]; then
  DEV_JSON="$(mktemp /tmp/kiko-devices-XXXXXX)"
  xcrun devicectl list devices --json-output "$DEV_JSON" >/dev/null 2>&1 || true
  # deviceType iPhone; match regardless of tunnel state (a paired device can
  # report "disconnected" yet still install via devicectl).
  # bash 3.2 (macOS /bin/bash) has no `mapfile`; use a read loop instead.
  IPHONE_IDS=()
  while IFS= read -r ident; do
    if [[ -n "$ident" ]]; then IPHONE_IDS+=("$ident"); fi
  done < <(python3 - "$DEV_JSON" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for dev in d.get("result", {}).get("devices", []):
    if dev.get("hardwareProperties", {}).get("deviceType") == "iPhone":
        ident = dev.get("identifier")
        if ident:
            print(ident)
PY
)
  rm -f "$DEV_JSON"
  if [[ ${#IPHONE_IDS[@]} -eq 0 ]]; then
    echo "Error: No iPhone found. Connect a device, or pass a device id."
    xcrun devicectl list devices || true
    exit 1
  elif [[ ${#IPHONE_IDS[@]} -gt 1 ]]; then
    echo "Error: Multiple iPhones found. Pass one explicitly:"
    printf '  %s\n' "${IPHONE_IDS[@]}"
    exit 1
  fi
  DEVICE_ID="${IPHONE_IDS[0]}"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "Error: Could not determine device ID."
  exit 1
fi

echo "Device: $DEVICE_ID"
echo ""

# Export FORCE_BUNDLING to ensure JS changes always ship
export FORCE_BUNDLING=1

# Build the app
echo "Building Kiko app..."
BUILD_OUTPUT=$( (xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration "$CONFIGURATION" -sdk "$SDK" -derivedDataPath "$DERIVED_DATA" 2>&1) || echo "BUILD_FAILED" )

if echo "$BUILD_OUTPUT" | grep -q "BUILD FAILED"; then
  echo "Initial build failed. Running pod install and retrying..."
  cd "$REPO_ROOT/ios"
  pod install > /dev/null 2>&1
  cd "$REPO_ROOT"
  
  # Retry build
  BUILD_OUTPUT=$( (xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration "$CONFIGURATION" -sdk "$SDK" -derivedDataPath "$DERIVED_DATA" 2>&1) || echo "BUILD_FAILED" )
  
  if echo "$BUILD_OUTPUT" | grep -q "BUILD FAILED"; then
    echo "Build failed even after pod install:"
    echo "$BUILD_OUTPUT" | tail -20
    exit 1
  fi
fi

if ! echo "$BUILD_OUTPUT" | grep -q "BUILD SUCCEEDED"; then
  echo "Build did not report success:"
  echo "$BUILD_OUTPUT" | tail -20
  exit 1
fi

echo "✓ Build succeeded"

# A Release build can reuse a cached main.jsbundle and ship old JS; a
# known-new string in the bundle is the only proof it regenerated.
BUNDLE_PATH="$APP_PATH/main.jsbundle"
if [[ -z "${EXPECT_BUNDLE_STRING:-}" ]]; then
  echo "Bundle check skipped (set EXPECT_BUNDLE_STRING)"
else
  BUNDLE_STATUS=0
  node "$SCRIPT_DIR/bundle-contains.js" "$BUNDLE_PATH" "$EXPECT_BUNDLE_STRING" || BUNDLE_STATUS=$?
  case "$BUNDLE_STATUS" in
    0)
      echo "✓ Bundle contains $EXPECT_BUNDLE_STRING"
      ;;
    1)
      echo "Stale bundle: main.jsbundle lacks \"$EXPECT_BUNDLE_STRING\"."
      echo "The build reused an old bundle despite FORCE_BUNDLING=1. Run make clean-ios, then deploy again."
      exit 1
      ;;
    *)
      echo "Bundle check failed: no readable bundle at $BUNDLE_PATH"
      exit 1
      ;;
  esac
fi

# Install app
echo "Installing app to device..."
INSTALL_OUTPUT=$(xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" 2>&1)
INSTALL_UUID=$(echo "$INSTALL_OUTPUT" | grep "databaseUUID:" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1 || true)

if [[ -z "$INSTALL_UUID" ]]; then
  echo "Install failed:"
  echo "$INSTALL_OUTPUT"
  exit 1
fi

echo "✓ App installed (container UUID: $INSTALL_UUID)"

# Launch app
echo "Launching app..."

# A launch right after install can fail transiently, so one retry separates
# that from a real failure. `|| true` keeps `set -e` from aborting before the
# output is shown.
launch_app() {
  xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1 || true
}

LAUNCH_OUTPUT=$(launch_app)

if ! echo "$LAUNCH_OUTPUT" | grep -q "Launched application"; then
  echo "Launch retry…"
  sleep 3
  LAUNCH_OUTPUT=$(launch_app)
fi

if echo "$LAUNCH_OUTPUT" | grep -q "Launched application"; then
  echo "✓ App launched"
else
  echo "Launch may have failed:"
  echo "$LAUNCH_OUTPUT"
  exit 1
fi

# Summary
echo ""
echo "=========================================="
echo "Device:  $DEVICE_ID"
echo "Build:   ✓ Release build succeeded"
echo "Install: ✓ Container UUID $INSTALL_UUID"
echo "Launch:  ✓ App started"
echo "=========================================="
