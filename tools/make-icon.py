"""Generate the mdlight app icon as a multi-size .ico.

Design: a rounded-square brand-blue tile with a white document whose page
shows a formula integral sign (∫) — mdlight = Markdown reading + math.

Everything is drawn with vector primitives at 1024, then the .ico is saved
with the standard Windows sizes (16/24/32/48/64/128/256). No external assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_ICO = ROOT / "assets" / "mdlight.ico"
OUT_PNG = ROOT / "assets" / "mdlight.png"

S = 1024  # master canvas
BLUE_TOP = (33, 116, 220)   # ~#2174dc
BLUE_BOT = (8, 62, 138)     # ~#083e8a
WHITE = (255, 255, 255)
LINE = (33, 116, 220)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\seguisym.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def load_font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_canvas():
    img = Image.new("RGB", (S, S), WHITE)
    d = ImageDraw.Draw(img)
    # vertical gradient tile
    grad = Image.new("RGB", (1, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.point((0, y), fill=tuple(int(BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t) for i in range(3)))
    grad = grad.resize((S, S))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=210, fill=255)
    img.paste(grad, (0, 0), mask)
    return img, ImageDraw.Draw(img)


def draw_document(d):
    # white page with a subtle dog-ear fold at the bottom-right
    x0, y0, x1, y1 = 250, 180, 774, 844
    rounded_rect(d, [x0, y0, x1, y1], 34, WHITE)
    # folded corner: light shadow triangle + fold flap
    d.polygon([(x1 - 118, y1), (x1, y1 - 118), (x1, y1)], fill=(210, 222, 240))
    d.polygon([(x1 - 118, y1), (x1, y1 - 118), (x1 - 118, y1 - 118)], fill=(226, 236, 250))
    # two text lines above the integral
    for (lx, ly, lw) in [(320, 264, 400), (320, 330, 300)]:
        d.rounded_rectangle([lx, ly, lx + lw, ly + 26], radius=13, fill=(150, 178, 214))
    # the integral sign — the mdlight motif, centered on the page
    font = load_font(400)
    d.text((505, 540), "\u222b", font=font, fill=LINE, anchor="mm")


def main():
    OUT_ICO.parent.mkdir(parents=True, exist_ok=True)
    img, d = make_canvas()
    draw_document(d)

    # smooth the master down and save sizes
    img.save(OUT_PNG, "PNG")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(OUT_ICO, "ICO", sizes=sizes)
    print(f"ICO: {OUT_ICO}")
    print(f"PNG: {OUT_PNG}")


if __name__ == "__main__":
    main()