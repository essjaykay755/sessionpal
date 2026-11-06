#!/bin/bash
# Build release DMGs using an installed Developer ID Application identity.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to your Developer ID Application certificate name}"
: "${APPLE_ID:?Set APPLE_ID to the Apple account used for notarization}"
: "${APPLE_PASSWORD:?Set APPLE_PASSWORD to an Apple app-specific password}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple Developer Team ID}"
case "$APPLE_SIGNING_IDENTITY" in
  'Developer ID Application:'*) ;;
  *) echo 'A Developer ID Application identity is required.' >&2; exit 1 ;;
esac

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target add "$target"
  npm run tauri:build -- --target "$target" --bundles app,dmg
  app="src-tauri/target/$target/release/bundle/macos/SessionPal.app"
  codesign --verify --deep --strict --verbose=2 "$app"
  spctl --assess --type execute --verbose=2 "$app"
  xcrun stapler validate "$app"
done
