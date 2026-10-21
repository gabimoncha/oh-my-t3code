#!/bin/sh
# Runs the native tsrs binary directly. The npm launcher in node_modules/.bin/tsrs starts Node
# first, which costs about 30 ms, more than the type check itself. The binary choice follows
# node_modules/tsrs/lib/platform.js.
set -eu

if [ -n "${TSRS_BINARY:-}" ]; then
  exec "$TSRS_BINARY" "$@"
fi

case "$0" in
  */*) modules="${0%/*}/../node_modules" ;;
  *) modules=../node_modules ;;
esac

case "$(uname -sm)" in
  "Darwin arm64") package=darwin-arm64 ;;
  "Linux aarch64" | "Linux arm64") package=linux-arm64 ;;
  "Linux x86_64") package=linux-x64 ;;
  *) package= ;;
esac

# Bun installs both Linux packages, because they declare no libc field.
case "$package" in
  linux-*)
    if grep -qs musl /usr/bin/ldd || ldd --version 2>&1 | grep -q musl; then
      package="$package-musl"
    else
      package="$package-gnu"
    fi
    ;;
esac

binary="$modules/@tsrs/$package/tsrs"
if [ -n "$package" ] && [ -x "$binary" ]; then
  exec "$binary" "$@"
fi

# The launcher explains why no binary fits this machine.
exec "$modules/.bin/tsrs" "$@"
