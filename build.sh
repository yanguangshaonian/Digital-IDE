#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo 'ERROR: Install Node.js 22 or newer.' >&2; exit 1; }
exec node scripts/build.cjs "$@"