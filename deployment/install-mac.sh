#!/bin/bash
# ORRERY Unsigned Mac Installer (Gatekeeper Bypass)
# Seamless setup for non-technical macOS users.

set -e

APP_URL="https://github.com/ORRERY/ORRERY/releases/latest/download/ORRERY-mac.zip"
DOWNLOAD_DIR="/tmp/ORRERY_install"

echo "==============================================="
echo " ORRERY Seamless macOS Installer             "
echo "==============================================="

# 1. Download
rm -rf "$DOWNLOAD_DIR"
mkdir -p "$DOWNLOAD_DIR"
echo "=> Downloading latest release..."
curl -L -o "$DOWNLOAD_DIR/ORRERY.zip" "$APP_URL"

# 2. Extract
echo "=> Extracting application..."
unzip -q "$DOWNLOAD_DIR/ORRERY.zip" -d "$DOWNLOAD_DIR"

# 3. Strip Quarantine (Gatekeeper Bypass)
echo "=> Authorizing application (Bypassing Gatekeeper warnings)..."
xattr -cr "$DOWNLOAD_DIR/ORRERY.app"

# 4. Move to Applications
echo "=> Installing to /Applications..."
rm -rf "/Applications/ORRERY.app"
mv "$DOWNLOAD_DIR/ORRERY.app" "/Applications/"

# 5. Clean & Launch
rm -rf "$DOWNLOAD_DIR"
echo "=> Launching ORRERY..."
open -a "ORRERY"

echo "✅ Installation Complete! You can now use ORRERY securely."
