#!/usr/bin/env python3
"""Generate NIGHTRUN app icons + favicon (no external assets required).

Run:  python3 tools/make-icons.py
Writes into public/icons/. Deterministic output, pure Pillow.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

CRIMSON = (255, 47, 109)
VIOLET = (162, 75, 255)
CYAN = (69, 240, 255)
BLUE = (47, 107, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c0, c1, c2, angle=0.75):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size) * (1 - angle) + (y / size) * angle
            col = lerp(c0, c1, min(1.0, t * 1.6)) if t < 0.62 else lerp(c1, c2, (t - 0.62) / 0.38)
            px[x, y] = col
    return img


def glow_layer(size, draw_fn, color, blur):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_fn(d, color + (255,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def make_icon(size, padding_ratio=0.0, maskable=False):
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 255))

    # Deep night background with a violet bloom
    bg = Image.new("RGBA", (S, S), (5, 2, 10, 255))
    bloom = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bloom)
    bd.ellipse([S * 0.08, S * 0.02, S * 0.92, S * 0.86], fill=(70, 20, 120, 255))
    bloom = bloom.filter(ImageFilter.GaussianBlur(S * 0.16))
    bg = Image.alpha_composite(bg, bloom)
    img = Image.alpha_composite(img, bg)

    # Perspective road grid (neon floor)
    grid = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    horizon = S * 0.60
    vp = S * 0.5
    for i in range(-7, 8):
        x_end = vp + i * S * 0.34
        gd.line([(vp, horizon), (x_end, S * 1.02)], fill=(69, 240, 255, 90), width=max(1, int(S * 0.006)))
    for j in range(1, 8):
        t = (j / 8.0) ** 2.2
        y = horizon + t * (S - horizon) * 1.15
        gd.line([(0, y), (S, y)], fill=(162, 75, 255, 80), width=max(1, int(S * 0.005)))
    grid = grid.filter(ImageFilter.GaussianBlur(S * 0.004))
    img = Image.alpha_composite(img, grid)

    # Glyph: angular "N" made of three neon bars + a shard diamond
    dot = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(dot)

    def glyph(dr, col):
        w = S * 0.115
        top = S * 0.235
        bot = S * 0.735
        left = S * 0.305
        right = S * 0.695
        r = w * 0.28
        dr.rounded_rectangle([left, top, left + w, bot], radius=r, fill=col)
        dr.rounded_rectangle([right - w, top, right, bot], radius=r, fill=col)
        # diagonal
        dr.polygon(
            [
                (left + w * 0.08, top),
                (left + w * 1.05, top),
                (right - w * 0.05, bot),
                (right - w * 1.0, bot),
            ],
            fill=col,
        )

    # Coloured glow passes
    for color, blur, off in ((CYAN, S * 0.055, 0), (VIOLET, S * 0.10, 0), (CRIMSON, S * 0.02, 0)):
        gl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        glyph(ImageDraw.Draw(gl), color + (190 if color is not CYAN else 220,))
        img = Image.alpha_composite(img, gl.filter(ImageFilter.GaussianBlur(blur)))

    # Solid glyph with vertical neon gradient
    gmask = Image.new("L", (S, S), 0)
    glyph(ImageDraw.Draw(gmask), 255)
    grad = gradient(S, CYAN, VIOLET, CRIMSON, angle=0.9).convert("RGBA")
    grad.putalpha(gmask)
    img = Image.alpha_composite(img, grad)

    # Shard accent above the N
    sx, sy, sr = S * 0.5, S * 0.135, S * 0.072
    shard = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shard)
    sd.polygon([(sx, sy - sr), (sx + sr * 0.72, sy), (sx, sy + sr), (sx - sr * 0.72, sy)], fill=(255, 204, 102, 255))
    img = Image.alpha_composite(img, shard.filter(ImageFilter.GaussianBlur(S * 0.012)))
    img = Image.alpha_composite(img, shard)

    # Vignette
    vig = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-S * 0.25, -S * 0.25, S * 1.25, S * 1.25], outline=(0, 0, 0, 0))
    vd.rectangle([0, 0, S, S], fill=None)
    edge = Image.new("L", (S, S), 0)
    ImageDraw.Draw(edge).ellipse([-S * 0.12, -S * 0.12, S * 1.12, S * 1.12], fill=255)
    dark = Image.new("RGBA", (S, S), (3, 0, 8, 235))
    dark.putalpha(Image.eval(edge, lambda v: 255 - v))
    img = Image.alpha_composite(img, dark)

    if maskable or padding_ratio:
        pad = int(S * (padding_ratio or (0.1 if maskable else 0)))
        base = Image.new("RGBA", (S, S), (5, 2, 10, 255))
        inner = img.resize((S - 2 * pad, S - 2 * pad), Image.LANCZOS)
        base.alpha_composite(inner, (pad, pad))
        img = base

    return img.convert("RGB") if not maskable and not padding_ratio else img.convert("RGB")


def rounded(img, radius_ratio=0.22):
    S = img.size[0]
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


# --- standard icons (any purpose) ---
for size in (32, 96, 144, 192, 384, 512):
    make_icon(size).save(os.path.join(OUT, f"icon-{size}.png"), optimize=True)

# --- maskable (safe-zone padded) ---
make_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
make_icon(192, maskable=True).save(os.path.join(OUT, "icon-maskable-192.png"), optimize=True)

# --- apple touch icon (iOS rounds it itself; keep it square + opaque) ---
make_icon(180).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)

# --- splash-ish wide icon for the manifest screenshots is not required ---
print("icons written to", os.path.abspath(OUT))

# --- SVG favicon (hand written, sharp at any size) ---
svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#45f0ff"/>
      <stop offset="0.55" stop-color="#a24bff"/>
      <stop offset="1" stop-color="#ff2f6d"/>
    </linearGradient>
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2"/>
    </filter>
  </defs>
  <rect width="64" height="64" rx="14" fill="#05020a"/>
  <g filter="url(#b)" opacity="0.85" fill="#a24bff">
    <path d="M20 46V18h7l10 18V18h7v28h-7L27 28v18z"/>
  </g>
  <path d="M20 46V18h7l10 18V18h7v28h-7L27 28v18z" fill="url(#g)"/>
  <path d="M32 8l4 5-4 6-4-6z" fill="#ffcc66"/>
</svg>
"""
with open(os.path.join(OUT, "favicon.svg"), "w") as f:
    f.write(svg)
print("favicon.svg written")
