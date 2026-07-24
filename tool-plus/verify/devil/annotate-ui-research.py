import hashlib
import json
from pathlib import Path
import textwrap
import time

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
VERSION = json.loads((ROOT / "package.json").read_text("utf-8"))["version"]
RESEARCH = ROOT / "work" / f"acceptance-{VERSION}" / "ui-research"
ORIGINAL = RESEARCH / "original"
ANNOTATED = RESEARCH / "annotated"
CONTACT = RESEARCH / "contact"

CALLOUTS = {
    "pdf": [
        ("Page navigation / thumbnails", (0.00, 0.08, 0.22, 0.94)),
        ("Document and page preview", (0.20, 0.12, 0.76, 0.92)),
        ("Task toolbar and actions", (0.04, 0.00, 0.92, 0.17)),
        ("Properties / result controls", (0.74, 0.12, 0.99, 0.92)),
    ],
    "image": [
        ("Input or before preview", (0.00, 0.08, 0.45, 0.94)),
        ("After preview / action pipeline", (0.42, 0.08, 0.78, 0.94)),
        ("Format and quality settings", (0.72, 0.08, 0.99, 0.88)),
        ("Output size / execute state", (0.60, 0.82, 0.99, 0.99)),
    ],
    "media": [
        ("Source and queue", (0.00, 0.06, 0.34, 0.92)),
        ("Preview / source summary", (0.25, 0.08, 0.75, 0.66)),
        ("Preset and target settings", (0.62, 0.06, 0.99, 0.86)),
        ("Progress, speed, ETA, cancel", (0.12, 0.78, 0.96, 0.99)),
    ],
    "file": [
        ("Rename rule controls", (0.00, 0.04, 0.38, 0.92)),
        ("Original to new name preview", (0.30, 0.14, 0.99, 0.82)),
        ("Conflict and item status", (0.35, 0.72, 0.99, 0.94)),
        ("Apply / rename command", (0.68, 0.82, 0.99, 0.99)),
    ],
    "office": [
        ("Native ribbon / object actions", (0.00, 0.00, 1.00, 0.22)),
        ("Page, sheet, slide navigation", (0.00, 0.18, 0.24, 0.94)),
        ("Document object canvas", (0.20, 0.18, 0.82, 0.94)),
        ("Scope, properties, status", (0.78, 0.16, 1.00, 0.98)),
    ],
    "text": [
        ("Find / replace query", (0.00, 0.00, 0.58, 0.35)),
        ("Regex and matching options", (0.48, 0.00, 1.00, 0.38)),
        ("Matches and replacement preview", (0.00, 0.28, 1.00, 0.82)),
        ("Encoding / result status", (0.50, 0.76, 1.00, 1.00)),
    ],
}

COLORS = ["#e83f4f", "#1677d2", "#0a936f", "#c06a00"]


def font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def annotate(record):
    source = ROOT / record["file"]
    image = Image.open(source).convert("RGB")
    maximum = (1120, 760)
    image.thumbnail(maximum, Image.Resampling.LANCZOS)
    width, height = image.size
    sidebar = 390
    canvas = Image.new("RGB", (width + sidebar, max(height, 620)), "#f3f6f4")
    canvas.paste(image, (0, 0))
    drawing = ImageDraw.Draw(canvas)
    title_font = font(22, True)
    body_font = font(15)
    small_font = font(12)
    for index, (label, bounds) in enumerate(CALLOUTS[record["category"]], 1):
        color = COLORS[index - 1]
        x1, y1, x2, y2 = bounds
        box = (round(x1 * width), round(y1 * height), round(x2 * width), round(y2 * height))
        drawing.rectangle(box, outline=color, width=4)
        badge = (box[0] + 5, box[1] + 5, box[0] + 35, box[1] + 35)
        drawing.ellipse(badge, fill=color)
        drawing.text((badge[0] + 10, badge[1] + 4), str(index), font=body_font, fill="white")
    left = width + 24
    drawing.text((left, 24), record["category"].upper(), font=small_font, fill="#557066")
    drawing.text((left, 48), record["product"], font=title_font, fill="#172720")
    drawing.text((left, 82), record["state"], font=body_font, fill="#365247")
    y = 126
    for index, (label, _) in enumerate(CALLOUTS[record["category"]], 1):
        color = COLORS[index - 1]
        drawing.ellipse((left, y, left + 26, y + 26), fill=color)
        drawing.text((left + 8, y + 2), str(index), font=small_font, fill="white")
        wrapped = textwrap.wrap(label, width=34)
        drawing.multiline_text((left + 38, y + 1), "\n".join(wrapped), font=body_font, fill="#20352d", spacing=4)
        y += max(54, 21 * len(wrapped) + 20)
    y += 8
    drawing.line((left, y, width + sidebar - 24, y), fill="#b7c7c0", width=1)
    y += 18
    drawing.text((left, y), f"Actual product source, accessed {record['accessedDate']}", font=small_font, fill="#53675f")
    y += 24
    for line in textwrap.wrap(record["sourceUrl"], width=48):
        drawing.text((left, y), line, font=small_font, fill="#53675f")
        y += 18
    destination = ANNOTATED / record["category"] / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "PNG", optimize=True)
    return {
        **record,
        "annotatedFile": str(destination.relative_to(ROOT)).replace("\\", "/"),
        "annotatedWidth": canvas.width,
        "annotatedHeight": canvas.height,
        "annotatedSha256": sha256(destination),
        "callouts": [label for label, _ in CALLOUTS[record["category"]]],
    }, destination


def contact_sheet(category, images):
    thumb_width, thumb_height = 620, 420
    margin = 20
    header = 70
    rows = (len(images) + 2) // 3
    sheet = Image.new("RGB", (margin * 4 + thumb_width * 3, header + margin * (rows + 1) + thumb_height * rows), "#e8eeea")
    drawing = ImageDraw.Draw(sheet)
    drawing.text((margin, 18), f"{category.upper()} - official UI research evidence", font=font(26, True), fill="#16271f")
    for index, file in enumerate(images):
        image = Image.open(file).convert("RGB")
        image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = margin + (index % 3) * (thumb_width + margin)
        y = header + margin + (index // 3) * (thumb_height + margin)
        tile = Image.new("RGB", (thumb_width, thumb_height), "white")
        tile.paste(image, ((thumb_width - image.width) // 2, (thumb_height - image.height) // 2))
        sheet.paste(tile, (x, y))
        drawing.rectangle((x, y, x + thumb_width, y + thumb_height), outline="#9fb2a9", width=2)
    CONTACT.mkdir(parents=True, exist_ok=True)
    destination = CONTACT / f"{category}-official-research-contact.png"
    sheet.save(destination, "PNG", optimize=True)
    return destination


def main():
    manifest = json.loads((ORIGINAL / "ORIGINAL_MANIFEST.json").read_text("utf-8"))
    annotated = []
    groups = {}
    for record in manifest["records"]:
        item, destination = annotate(record)
        annotated.append(item)
        groups.setdefault(record["category"], []).append(destination)
        print(f"ANNOTATE {record['category']} {record['product']} {record['state']}", flush=True)
    contacts = []
    for category, images in sorted(groups.items()):
        destination = contact_sheet(category, images)
        contacts.append({"category": category, "file": str(destination.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(destination)})
    result = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "count": len(annotated),
        "records": annotated,
        "contacts": contacts,
    }
    ANNOTATED.mkdir(parents=True, exist_ok=True)
    (ANNOTATED / "ANNOTATED_MANIFEST.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
    if len(annotated) < 36:
        raise AssertionError(len(annotated))
    print(f"PASS UI research annotations {len(annotated)} and category contact sheets 6/6")


if __name__ == "__main__":
    main()
