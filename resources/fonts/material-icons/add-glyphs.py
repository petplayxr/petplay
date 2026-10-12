#!/usr/bin/env python3
"""Append glyphs from MaterialIcons-Regular.ttf to the icon atlas.

    python3 resources/fonts/material-icons/add-glyphs.py e14a e31b ...
    python3 resources/fonts/material-icons/add-glyphs.py --ttf Roboto-Regular.ttf --base 64 e4 f6

`--ttf` takes glyphs from another font. Keycap legends use this for letters the Roboto text atlas
lacks (it lives in the threewebxrwebgpudeno submodule): Material Icons sits in the Private Use
Area, so Latin-1 codepoints don't collide. `--base` sets the baseline those glyphs are placed
against; 64 reproduces the Roboto atlas's own glyph offsets exactly.

The original atlas came from msdf-bmfont; this adds glyphs without it (no npm tooling), using
only fontTools, numpy and Pillow. New glyphs are plain signed distance fields written to R, G and
B alike: the MSDF shader takes the median of the three channels, so an SDF draws correctly, just
with slightly rounder corners than a true MSDF (invisible at keycap and toolbar sizes).

Metrics follow the existing atlas exactly (size 80, padding 2, distance range 4), so new glyphs
line up with the old ones. Codepoints already in the atlas are skipped. New glyphs go in rows
below the existing image, which grows taller; `common.scaleH` is updated to match.
"""
import json
import sys
from pathlib import Path

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from PIL import Image

HERE = Path(__file__).parent
FNT = HERE / "material-icons.fnt"
PNG = HERE / "material-icons.png"
TTF = HERE / "MaterialIcons-Regular.ttf"


class FlattenPen(BasePen):
    """Collects each contour as a polyline, flattening curves into short segments."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours = []
        self.current = []

    def _moveTo(self, pt):
        self.current = [pt]

    def _lineTo(self, pt):
        self.current.append(pt)

    def _qCurveToOne(self, pt1, pt2):
        p0 = self.current[-1]
        for i in range(1, 17):
            t = i / 16
            u = 1 - t
            self.current.append((
                u * u * p0[0] + 2 * u * t * pt1[0] + t * t * pt2[0],
                u * u * p0[1] + 2 * u * t * pt1[1] + t * t * pt2[1],
            ))

    def _curveToOne(self, pt1, pt2, pt3):
        p0 = self.current[-1]
        for i in range(1, 17):
            t = i / 16
            u = 1 - t
            self.current.append((
                u**3 * p0[0] + 3 * u * u * t * pt1[0] + 3 * u * t * t * pt2[0] + t**3 * pt3[0],
                u**3 * p0[1] + 3 * u * u * t * pt1[1] + 3 * u * t * t * pt2[1] + t**3 * pt3[1],
            ))

    def _closePath(self):
        if self.current and self.current[0] != self.current[-1]:
            self.current.append(self.current[0])
        if len(self.current) > 2:
            self.contours.append(self.current)
        self.current = []

    _endPath = _closePath


def render_sdf(contours, width, height, to_font, distance_range):
    """Signed distance in pixels at each pixel centre (positive inside), mapped to 0..255."""
    segments = np.array(
        [(*c[i], *c[i + 1]) for c in contours for i in range(len(c) - 1)], dtype=np.float64
    )
    ax, ay, bx, by = (segments[:, k] for k in range(4))
    cols, rows = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    px, py = to_font(cols.ravel(), rows.ravel())
    px = px[:, None]
    py = py[:, None]
    dx, dy = bx - ax, by - ay
    length2 = np.maximum(dx * dx + dy * dy, 1e-12)
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / length2, 0, 1)
    distance = np.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2).min(axis=1)
    # Nonzero winding: Material Icons overlaps contours, so even-odd would punch holes.
    cross = (bx - ax) * (py - ay) - (px - ax) * (by - ay)
    up = (ay <= py) & (by > py) & (cross > 0)
    down = (by <= py) & (ay > py) & (cross < 0)
    inside = (up.sum(axis=1) - down.sum(axis=1)) != 0
    return distance, inside


def main(codes, ttf_path=TTF, base=None):
    font = json.loads(FNT.read_text())
    have = {char["id"] for char in font["chars"]}
    wanted = [code for code in codes if code not in have]
    if not wanted:
        print("nothing to add")
        return

    ttf = TTFont(str(ttf_path))
    cmap = ttf.getBestCmap()
    glyph_set = ttf.getGlyphSet()
    order = ttf.getGlyphOrder()
    units = ttf["head"].unitsPerEm
    size = font["info"]["size"]
    pad = font["info"]["padding"][0]
    distance_range = font["distanceField"]["distanceRange"]
    base = font["common"]["base"] if base is None else base
    scale = size / units
    ascent = units * base / size

    image = np.array(Image.open(PNG).convert("RGBA"))
    atlas_width = image.shape[1]
    glyphs = []
    for code in wanted:
        name = cmap.get(code)
        if name is None:
            sys.exit(f"U+{code:04X} is not in {Path(ttf_path).name}")
        pen = FlattenPen(glyph_set)
        glyph_set[name].draw(pen)
        if not pen.contours:
            print(f"skipping U+{code:04X}: no outline")
            continue
        xs = [x for c in pen.contours for x, _ in c]
        ys = [y for c in pen.contours for _, y in c]
        x_min, x_max, y_min, y_max = min(xs), max(xs), min(ys), max(ys)
        width = round((x_max - x_min) * scale) + 2 * pad
        height = round((y_max - y_min) * scale) + 2 * pad
        xoffset = round(x_min * scale) - pad
        yoffset = round((ascent - y_max) * scale) - pad

        def to_font(col, row, xoffset=xoffset, yoffset=yoffset):
            return (xoffset + col) / scale, ascent - (yoffset + row) / scale

        distance, inside = render_sdf(pen.contours, width, height, to_font, distance_range)
        signed = np.where(inside, distance, -distance) * scale
        value = np.clip(0.5 + signed / distance_range, 0, 1)
        pixels = np.round(value * 255).astype(np.uint8).reshape(height, width)
        glyphs.append({
            "code": code,
            "index": order.index(name),
            "width": width,
            "height": height,
            "xoffset": xoffset,
            "yoffset": yoffset,
            "xadvance": round(glyph_set[name].width * scale),
            "pixels": pixels,
        })

    # Shelf-pack the new glyphs into rows under the current image.
    top = image.shape[0] + 2
    x = 0
    row_height = 0
    for glyph in glyphs:
        if x + glyph["width"] > atlas_width:
            top += row_height + 2
            x = 0
            row_height = 0
        glyph["x"], glyph["y"] = x, top
        x += glyph["width"] + 2
        row_height = max(row_height, glyph["height"])
    new_height = top + row_height
    grown = np.zeros((new_height, atlas_width, 4), dtype=np.uint8)
    grown[..., 3] = 255
    grown[: image.shape[0]] = image
    for glyph in glyphs:
        h, w = glyph["pixels"].shape
        for channel in range(3):
            grown[glyph["y"] : glyph["y"] + h, glyph["x"] : glyph["x"] + w, channel] = glyph["pixels"]
        font["chars"].append({
            "id": glyph["code"],
            "index": glyph["index"],
            "char": chr(glyph["code"]),
            "width": glyph["width"],
            "height": glyph["height"],
            "xoffset": glyph["xoffset"],
            "yoffset": glyph["yoffset"],
            "xadvance": glyph["xadvance"],
            "chnl": 15,
            "x": glyph["x"],
            "y": glyph["y"],
            "page": 0,
        })
        font["info"]["charset"].append(chr(glyph["code"]))
    font["common"]["scaleH"] = new_height
    Image.fromarray(grown, "RGBA").save(PNG, optimize=True)
    FNT.write_text(json.dumps(font))
    print(f"added {', '.join(f'U+{g['code']:04X}' for g in glyphs)}; atlas now {atlas_width}x{new_height}")


if __name__ == "__main__":
    args = sys.argv[1:]
    options = {}
    while args and args[0].startswith("--"):
        options[args[0][2:]] = args[1]
        args = args[2:]
    main(
        [int(arg, 16) for arg in args],
        ttf_path=options.get("ttf", TTF),
        base=int(options["base"]) if "base" in options else None,
    )
