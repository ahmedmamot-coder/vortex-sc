#!/usr/bin/env bash
#
# Assemble the web bundle that ships INSIDE the binary.
#
# proto.html is 1.75 MB, and fetching it on every cold start is most of what people call "the
# sign-in is slow". To an App Store reviewer on a hotel connection it is a white screen they will
# file as a crash under 2.1. So the shell travels in the app and only the data comes over the
# network, live from Supabase, exactly as it does on the web.
#
# Run from anywhere:  bash ios/scripts/sync-web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/vortex-app/public"
DEST="$ROOT/ios/App/www"

[ -d "$SRC" ] || { echo "error: $SRC not found — run this from inside the repository"; exit 1; }

echo "→ assembling $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"

# Everything the app serves, minus the things that only make sense on the web.
#   sw.js               — a service worker is meaningless in a WKWebView, and registering one
#                         that intercepts navigations inside the app is a way to serve a stale
#                         shell that the app cannot clear.
#   .well-known/        — Android app-links verification.
# cp -R rather than rsync: a Mac has rsync, but so does every CI image that does not, and this
# script should not be the reason a build fails on somebody else's machine.
cp -R "$SRC"/. "$DEST"/
rm -f "$DEST/sw.js"
rm -rf "$DEST/.well-known"

# index.html below is a copy of proto.html, and nothing in the app links to /proto.html by name.
# Shipping both puts the same 1.8 MB in the binary twice.
rm -f "$DEST/proto.html"

# vortex-handbook.pdf stays: the Handbook screen opens it by relative path, and a bundle without
# it is a button that does nothing. It is 14 MB of the ~22 MB total, which is the price.

# index.html is proto.html: on the web a rewrite in next.config.ts serves it at "/", and there is
# no Next.js server inside the app to do that.
cp "$SRC/proto.html" "$DEST/index.html"

# Load the native bridge BEFORE the app, so window.print, <a download>, window.open and
# navigator.share are already patched when the first tap happens.
python3 - "$DEST/index.html" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if 'native-bridge.js' in s:
    print("  bridge already present"); raise SystemExit
tag = '<script src="native-bridge.js"></script>\n'
# Ahead of the first script on the page, whichever that is.
m = re.search(r'<script[\s>]', s)
if not m:
    print("  error: no <script> tag found in index.html"); raise SystemExit(1)
s = s[:m.start()] + tag + s[m.start():]
open(p, 'w', encoding='utf-8').write(s)
print("  native-bridge.js injected ahead of the app")
PY

echo "→ $(du -sh "$DEST" | cut -f1) in $DEST"
echo "   next:  cd vortex-app && npx cap sync ios"
