from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parent
BACKGROUND = ROOT / "generated-backgrounds"
FINAL = ROOT / "final"
BRAND = ROOT.parent / "brand"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

INK = (236, 239, 225, 255)
MUTED = (171, 176, 162, 255)
OLIVE = (174, 207, 119, 255)
BLUE = (141, 196, 212, 255)
GOLD = (216, 193, 103, 255)
LINE = (216, 228, 188, 90)
DARK = (11, 14, 12, 220)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size=size)


def load_bg(name: str) -> Image.Image:
    return Image.open(BACKGROUND / name / "openai-gpt-image-2" / "image.png").convert("RGBA")


def fit_logo(size: int) -> Image.Image:
    logo = Image.open(BRAND / "ob1-beanie-mark-cream.png").convert("RGBA")
    logo.thumbnail((size, size), Image.Resampling.LANCZOS)
    return logo


def overlay_gradient(img: Image.Image, opacity: int = 150) -> Image.Image:
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = layer.load()
    for x in range(w):
        for y in range(h):
            left = 1 - (x / max(w - 1, 1))
            bottom = y / max(h - 1, 1)
            alpha = int(opacity * (0.35 + 0.65 * left) + 42 * bottom)
            px[x, y] = (6, 8, 7, min(alpha, 235))
    return Image.alpha_composite(img, layer)


def add_microtype(img: Image.Image, text: str = "NBJ OB1") -> Image.Image:
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = font(12, bold=True)
    for y in range(-20, h + 40, 86):
        for x in range(-20, w + 180, 182):
            draw.text((x, y), text, font=f, fill=(230, 240, 205, 18))
    layer = layer.filter(ImageFilter.GaussianBlur(0.15))
    return Image.alpha_composite(img, layer)


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill=OLIVE) -> None:
    x, y = xy
    f = font(22, bold=True)
    pad_x, pad_y = 14, 8
    box = draw.textbbox((x, y), text, font=f)
    draw.rectangle(
        (x - pad_x, y - pad_y, box[2] + pad_x, box[3] + pad_y),
        outline=(fill[0], fill[1], fill[2], 105),
        fill=(20, 24, 20, 125),
        width=1,
    )
    draw.text((x, y), text, font=f, fill=fill)


def draw_footer(draw: ImageDraw.ImageDraw, w: int, h: int) -> None:
    footer = "Built by Nate B. Jones / OB1  |  substack.com/@natesnewsletter  |  natebjones.com"
    draw.text((48, h - 56), footer, font=font(20), fill=(216, 222, 199, 205))


def draw_logo_lockup(img: Image.Image, draw: ImageDraw.ImageDraw, x: int, y: int, logo_size: int = 74) -> None:
    logo = fit_logo(logo_size)
    img.alpha_composite(logo, (x, y))
    draw.text((x + logo_size + 18, y + 8), "NBJ / OB1", font=font(24, bold=True), fill=INK)
    draw.text((x + logo_size + 18, y + 40), "AGENT MEMORY", font=font(16, bold=True), fill=(OLIVE[0], OLIVE[1], OLIVE[2], 220))


def save(img: Image.Image, name: str) -> None:
    FINAL.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(FINAL / name, quality=95, optimize=True)


def hero() -> None:
    img = overlay_gradient(load_bg("hero-16x9"), 165)
    img = add_microtype(img)
    draw = ImageDraw.Draw(img)
    draw_logo_lockup(img, draw, 64, 58, 82)
    draw.text((64, 205), "NBJ OB1", font=font(44, bold=True), fill=OLIVE)
    draw.text((64, 260), "Agent Memory", font=font(92, bold=True), fill=INK)
    draw.text((64, 356), "for OpenClaw", font=font(58, bold=True), fill=(209, 218, 194, 250))
    draw.text((68, 455), "Recall before the task. Write back after. Inspect everything.", font=font(31), fill=(218, 224, 204, 230))
    label(draw, (70, 545), "ClawHub plugin + skill")
    label(draw, (342, 545), "provenance-aware")
    label(draw, (592, 545), "human review")
    draw_footer(draw, *img.size)
    save(img, "nbj-ob1-agent-memory-hero-16x9.png")


def banner() -> None:
    img = overlay_gradient(load_bg("clawhub-banner"), 145)
    img = add_microtype(img)
    draw = ImageDraw.Draw(img)
    draw_logo_lockup(img, draw, 44, 42, 68)
    draw.text((44, 166), "NBJ OB1 Agent Memory", font=font(58, bold=True), fill=INK)
    draw.text((48, 235), "OpenClaw plugin + skill for governed recall and write-back.", font=font(29), fill=(219, 224, 204, 232))
    label(draw, (50, 320), "@natebjones/ob1-agent-memory")
    label(draw, (475, 320), "nbj-ob1-agent-memory-openclaw", fill=BLUE)
    draw.text((48, 446), "Follow Nate: substack.com/@natesnewsletter  |  natebjones.com", font=font(20), fill=(216, 222, 199, 205))
    save(img, "nbj-ob1-agent-memory-clawhub-banner.png")


def square() -> None:
    img = overlay_gradient(load_bg("social-square"), 165)
    img = add_microtype(img)
    draw = ImageDraw.Draw(img)
    draw_logo_lockup(img, draw, 62, 58, 76)
    draw.text((64, 228), "Agents need", font=font(58, bold=True), fill=INK)
    draw.text((64, 292), "memory they", font=font(58, bold=True), fill=INK)
    draw.text((64, 356), "can trust.", font=font(74, bold=True), fill=OLIVE)
    draw.text((68, 478), "NBJ OB1 Agent Memory gives OpenClaw", font=font(29), fill=(222, 227, 207, 232))
    draw.text((68, 520), "scoped recall, write-back, review queues,", font=font(29), fill=(222, 227, 207, 232))
    draw.text((68, 562), "and recall traces.", font=font(29), fill=(222, 227, 207, 232))
    label(draw, (72, 660), "evidence is not instruction")
    label(draw, (72, 724), "inspectable by default", fill=BLUE)
    draw.text((68, 930), "Nate B. Jones / OB1", font=font(21), fill=(216, 222, 199, 210))
    draw.text((68, 958), "substack.com/@natesnewsletter  |  natebjones.com", font=font(19), fill=(216, 222, 199, 190))
    save(img, "nbj-ob1-agent-memory-social-square.png")


def loop_card() -> None:
    img = overlay_gradient(load_bg("loop-card"), 135)
    img = add_microtype(img)
    draw = ImageDraw.Draw(img)
    draw_logo_lockup(img, draw, 58, 48, 72)
    draw.text((58, 160), "The governed agent memory loop", font=font(58, bold=True), fill=INK)
    draw.text((62, 232), "OpenClaw acts. OB1 remembers what is useful, sourced, and reviewable.", font=font(30), fill=(218, 224, 204, 230))
    nodes = [
        ((90, 420), "1", "Recall", "Scoped context\n+ use policy", OLIVE),
        ((455, 420), "2", "Work", "Agent task\nacross models", BLUE),
        ((820, 420), "3", "Write back", "Compact operational\nmemory", GOLD),
        ((1185, 420), "4", "Review", "Confirm, edit,\nor reject", OLIVE),
    ]
    for idx, ((x, y), num, title, body, color) in enumerate(nodes):
        draw.rounded_rectangle((x, y, x + 270, y + 220), radius=8, fill=(18, 22, 19, 190), outline=(color[0], color[1], color[2], 155), width=2)
        draw.text((x + 24, y + 24), num, font=font(28, bold=True), fill=color)
        draw.text((x + 24, y + 72), title, font=font(35, bold=True), fill=INK)
        draw.multiline_text((x + 24, y + 124), body, font=font(21), fill=(216, 222, 199, 215), spacing=8)
        if idx < len(nodes) - 1:
            draw.line((x + 290, y + 110, x + 345, y + 110), fill=LINE, width=3)
            draw.polygon([(x + 345, y + 110), (x + 329, y + 101), (x + 329, y + 119)], fill=LINE)
    draw_footer(draw, *img.size)
    save(img, "nbj-ob1-agent-memory-loop-card.png")


if __name__ == "__main__":
    hero()
    banner()
    square()
    loop_card()
