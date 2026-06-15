"""
One-shot helper: take the new logo PNG, knock out the outer white background
via corner flood-fill (preserves the white area inside the rounded square),
and write the cleaned source to apps/desktop/src-tauri/icons/app-icon.png.

Also writes a downscaled copy to apps/desktop/src/assets/brand/logo.png
for the in-app sidebar usage, and a 256px favicon to apps/desktop/public/favicon.png.

Full re-icon flow:
    python scripts/process-logo.py "<new logo path>"
    cd apps/desktop
    npx tauri icon src-tauri/icons/app-icon.png
    cargo clean -p ai-interpretation-desktop   # cargo does NOT track icon.ico mtime,
                                               # so a clean rebuild is required for the
                                               # new icon to be embedded into the exe.
    npm run tauri build   # or: npm run tauri dev
"""

import sys
from pathlib import Path
from PIL import Image
from collections import deque

SRC = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "apps/desktop/src-tauri/icons"
ASSETS_DIR = ROOT / "apps/desktop/src/assets/brand"
PUBLIC_DIR = ROOT / "apps/desktop/public"

ICON_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
print(f"Loaded {SRC} ({img.size})")

# Make sure the canvas is square — pad if needed (the source already is, but safe)
w, h = img.size
if w != h:
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    img = canvas
    w = h = side

# Flood fill from the four corners, knocking out anything close to white.
# Tolerance 24 keeps the soft anti-aliased edges of the logo intact.
WHITE_TOL = 24
px = img.load()
visited = [[False] * h for _ in range(w)]
q = deque()
for cx, cy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    q.append((cx, cy))

def is_whiteish(rgba):
    r, g, b, a = rgba
    return r >= 255 - WHITE_TOL and g >= 255 - WHITE_TOL and b >= 255 - WHITE_TOL

while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= w or y >= h or visited[x][y]:
        continue
    visited[x][y] = True
    r, g, b, a = px[x, y]
    if not is_whiteish((r, g, b, a)):
        continue
    # transparent
    px[x, y] = (255, 255, 255, 0)
    q.append((x + 1, y))
    q.append((x - 1, y))
    q.append((x, y + 1))
    q.append((x, y - 1))

# Crop to the bounding box of visible (non-transparent) pixels, then pad
# symmetrically to a square — gives a tight icon without skewed margins.
bbox = img.getbbox()
if bbox:
    img = img.crop(bbox)
    cw, ch = img.size
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    canvas.paste(img, ((side - cw) // 2, (side - ch) // 2))
    img = canvas
    print(f"Cropped + squared to {img.size}")

out_master = ICON_DIR / "app-icon.png"
img.save(out_master, "PNG")
print(f"Wrote {out_master} ({img.size})")

# In-app sidebar logo: 256x256 is plenty for a 42px UI element on retina
sidebar = img.resize((256, 256), Image.LANCZOS)
out_sidebar = ASSETS_DIR / "logo.png"
sidebar.save(out_sidebar, "PNG")
print(f"Wrote {out_sidebar}")

# Favicon: 256x256 png lives in /public, served at /favicon.png
fav = img.resize((256, 256), Image.LANCZOS)
out_fav = PUBLIC_DIR / "favicon.png"
fav.save(out_fav, "PNG")
print(f"Wrote {out_fav}")
