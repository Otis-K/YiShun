from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
CANVAS = 1024
BLUE = "#2024AA"


def make_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = 60
    draw.rounded_rectangle(
        (inset, inset, CANVAS - inset, CANVAS - inset),
        radius=220,
        fill=BLUE,
    )
    ring = 48
    draw.ellipse(
        (190, 190, CANVAS - 190, CANVAS - 190),
        outline="white",
        width=ring,
    )
    font_path = Path(r"C:\Windows\Fonts\segoeuib.ttf")
    font = ImageFont.truetype(str(font_path), 430)
    text = "D"
    box = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    width = box[2] - box[0]
    height = box[3] - box[1]
    x = (CANVAS - width) / 2 - box[0] - 8
    y = (CANVAS - height) / 2 - box[1] - 8
    draw.text((x, y), text, font=font, fill="white")
    return image


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    source = make_icon()
    source.resize((512, 512), Image.Resampling.LANCZOS).save(BUILD / "icon.png")
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    source.save(BUILD / "icon.ico", format="ICO", sizes=sizes)
    print(f"generated {BUILD / 'icon.ico'}")


if __name__ == "__main__":
    main()
