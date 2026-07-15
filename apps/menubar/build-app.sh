#!/usr/bin/env bash
# Builds the Swift menu bar binary and bundles it into a proper .app.
# LSUIElement=true makes it an agent app (no Dock icon, no main menu) — exactly
# what a menu bar widget needs. Output: dist/Fleetlens.app
set -euo pipefail

cd "$(dirname "$0")"

TARGET_NAME="FleetlensMenubar"
APP_NAME="Fleetlens"
BUNDLE_ID="ai.fleetlens.menubar"
VERSION="${MENUBAR_VERSION:-$(node -p "require('../../package.json').version" 2>/dev/null || echo 0.1.0)}"
DIST="dist"

# --universal: fat arm64+x86_64 binary. Release builds must use this — a
# host-arch-only binary gives Intel users "bad CPU type in executable".
# Plain string (not array): macOS ships bash 3.2 where "${a[@]}" under
# `set -u` dies on empty arrays. Unquoted expansion is intentional.
ARCH_FLAGS=""
if [[ "${1:-}" == "--universal" ]]; then
  ARCH_FLAGS="--arch arm64 --arch x86_64"
fi

echo "→ swift build -c release $ARCH_FLAGS"
swift build -c release $ARCH_FLAGS

BIN_PATH="$(swift build -c release $ARCH_FLAGS --show-bin-path)/$TARGET_NAME"
if [[ ! -f "$BIN_PATH" ]]; then
  echo "fatal: built binary not found at $BIN_PATH" >&2
  exit 1
fi

APP="$DIST/$APP_NAME.app"
echo "→ bundling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp "$BIN_PATH" "$APP/Contents/MacOS/$TARGET_NAME"

# Brand icons (SVGs) → Contents/Resources so Bundle.main.url(forResource:) finds them.
cp Resources/*.svg "$APP/Contents/Resources/" 2>/dev/null || true

# System Settings ignores SVG bundle resources for an app's identity. Build a
# native icon so Login Items shows the Fleetlens mark instead of a placeholder.
ICONSET="$DIST/Fleetlens.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for SPEC in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"; do
  SIZE="${SPEC%% *}"
  NAME="${SPEC#* }"
  sips -s format png -z "$SIZE" "$SIZE" Resources/fleetlens-mark.svg \
    --out "$ICONSET/$NAME" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Fleetlens.icns"
rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$TARGET_NAME</string>
  <key>CFBundleIconFile</key><string>Fleetlens.icns</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Fleetlens</string>
  <key>CFBundleDisplayName</key><string>Fleetlens</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Fleetlens menu bar reads local usage data only.</string>
</dict>
</plist>
EOF

# Best-effort ad-hoc signature. Real distribution needs Developer ID +
# notarization; ad-hoc is enough for local installs and avoids the
# "damaged/unsigned" Gatekeeper dance when copied by the CLI.
codesign --force --sign - --timestamp=none "$APP" 2>/dev/null && \
  echo "→ ad-hoc signed" || echo "→ codesign skipped (not fatal for local use)"

echo "✓ built $APP"
du -sh "$APP" | awk '{print "  size: " $1}'
