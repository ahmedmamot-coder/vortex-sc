#!/usr/bin/env bash
#
# The App Store icon, and the app icon set.
#
# Apple rejects an icon that carries an alpha channel, and rejects a marketing icon that is not
# exactly 1024x1024. The club's best source is assets/icon-512.png, which is 512 and DOES carry
# an alpha channel — fully opaque, but present, which is enough to fail the upload with
# "Invalid App Store Icon. The app store icon can't be transparent nor contain an alpha channel."
#
# So: flatten onto the brand black, and resample to 1024. The mark is a soft blue gradient with
# no fine detail and no text, which is the one case where a 2x upscale holds up. If a vector
# original of the mark ever turns up, replace SRC with it and delete this paragraph.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/vortex-app/public/assets/icon-512.png"
OUT="$ROOT/ios/AppIcon.appiconset"

python3 - "$SRC" "$OUT" <<'PY'
import sys, os, json
from PIL import Image

src_path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

src = Image.open(src_path).convert("RGBA")

# The brand black behind it, so flattening never reveals a white fringe on the anti-aliased edge.
BRAND = (10, 15, 26)

def render(size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size), BRAND)
    scaled = src.resize((size, size), Image.LANCZOS)
    canvas.paste(scaled, (0, 0), scaled)   # alpha used as the mask, then discarded
    return canvas

# Xcode 14 and later take a single 1024 and generate the rest. The smaller sizes are written too
# because a downscale done here with LANCZOS is sharper than one Xcode does at build time, and
# because an older project format still asks for them by name.
sizes = {
    "AppIcon-1024.png": 1024,
    "AppIcon-180.png": 180,   # iPhone home screen @3x
    "AppIcon-120.png": 120,   # iPhone home screen @2x / spotlight @3x
    "AppIcon-87.png": 87,     # settings @3x
    "AppIcon-80.png": 80,     # spotlight @2x
    "AppIcon-60.png": 60,     # notification @3x
    "AppIcon-58.png": 58,     # settings @2x
    "AppIcon-40.png": 40,     # notification @2x
}
for name, size in sizes.items():
    img = render(size)
    img.save(os.path.join(out_dir, name), "PNG", optimize=True)
    assert img.mode == "RGB", "an alpha channel would fail the upload"

contents = {
    "images": [{"filename": "AppIcon-1024.png", "idiom": "universal",
                "platform": "ios", "size": "1024x1024"}],
    "info": {"author": "xcode", "version": 1},
}
with open(os.path.join(out_dir, "Contents.json"), "w") as f:
    json.dump(contents, f, indent=2)

print("wrote %d icons to %s" % (len(sizes), out_dir))
for name, size in sorted(sizes.items(), key=lambda kv: -kv[1]):
    im = Image.open(os.path.join(out_dir, name))
    print("  %-20s %sx%s %s" % (name, im.size[0], im.size[1], im.mode))
PY

echo
echo "→ copy into the Xcode project once it exists:"
echo "   cp -R $OUT vortex-app/ios/App/App/Assets.xcassets/AppIcon.appiconset"
