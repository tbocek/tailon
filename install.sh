#!/usr/bin/env bash
set -euo pipefail

# Installs the latest tailon release binary for the current OS/architecture.
# Usage: curl -sL https://raw.githubusercontent.com/tbocek/tailon/main/install.sh | bash

REPO="tbocek/tailon"
BIN="tailon"

command -v curl >/dev/null || { echo "error: curl not found" >&2; exit 1; }

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="amd64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac
case "$os" in
  linux | darwin) ;;
  *) echo "error: unsupported OS: $os" >&2; exit 1 ;;
esac

asset="${BIN}-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

# Prefer /usr/local/bin, fall back to ~/.local/bin when it isn't writable.
dir="/usr/local/bin"
if [ ! -w "$dir" ]; then
  dir="$HOME/.local/bin"
  mkdir -p "$dir"
fi

echo "Downloading $url"
tmp="$(mktemp)"
curl -fsSL "$url" -o "$tmp"
chmod +x "$tmp"
mv "$tmp" "$dir/$BIN"
echo "Installed $BIN to $dir/$BIN"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "note: $dir is not on your PATH; add it to run '$BIN' directly." ;;
esac
