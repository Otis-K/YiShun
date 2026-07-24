import hashlib
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[2]
VERSION = json.loads((ROOT / "package.json").read_text("utf-8"))["version"]
TARGET = ROOT / "work" / f"acceptance-{VERSION}" / "ui-research" / "original"

STATIC = [
    # PDF: full product-operation screenshots from PDFgear official tutorials.
    ("pdf", "pdfgear", "open-document", "https://www.pdfgear.com/pdf-editor-reader/img/open-pdfgear-for-pdf-annotation-on-windows.jpg"),
    ("pdf", "pdfgear", "annotation-tools", "https://www.pdfgear.com/pdf-editor-reader/img/annotate-a-pdf-in-pdfgear-with-diverse-tools.jpg"),
    ("pdf", "pdfgear", "save-result", "https://www.pdfgear.com/pdf-editor-reader/img/save-the-annotated-pdf-in-pdfgear.jpg"),
    ("pdf", "pdfgear", "page-thumbnails", "https://www.pdfgear.com/pdf-editor-reader/img/preview-thumbnail-view.jpg"),
    ("pdf", "pdfgear", "extract-settings", "https://www.pdfgear.com/how-to/img/customize-the-extract-pages-settings.jpg"),
    ("pdf", "pdfgear", "merge-workflow", "https://www.pdfgear.com/pdf-editor-reader/img/click-on-merge-and-then-add-files-option-pdfgear.jpg"),

    # Image: XnConvert batch workflow and Squoosh comparison workflow.
    ("image", "xnconvert", "batch-input", "https://www.xnview.com/img/screenshots/xnconvert-win-01.jpg"),
    ("image", "xnconvert", "actions", "https://www.xnview.com/img/screenshots/xnconvert-win-02.jpg"),
    ("image", "xnconvert", "output-settings", "https://www.xnview.com/img/screenshots/xnconvert-win-03.jpg"),
    ("image", "squoosh", "comparison", "https://raw.githubusercontent.com/GoogleChromeLabs/squoosh/dev/src/static-build/assets/screenshot1.png"),
    ("image", "squoosh", "codec-settings", "https://raw.githubusercontent.com/GoogleChromeLabs/squoosh/dev/src/static-build/assets/screenshot2.jpg"),
    ("image", "squoosh", "result-preview", "https://raw.githubusercontent.com/GoogleChromeLabs/squoosh/dev/src/static-build/assets/screenshot4.png"),

    # Media: HandBrake source/preset/progress and Shutter Encoder workspace/settings/queue.
    ("media", "handbrake", "source-selection", "https://handbrake.fr/docs/en/images/mac/title-selection-1.1.0.png"),
    ("media", "handbrake", "preset-selection", "https://handbrake.fr/docs/en/images/mac/preset-selection-1.1.0.png"),
    ("media", "handbrake", "running-progress", "https://handbrake.fr/docs/en/images/mac/encode-progress-1.1.0.png"),
    ("media", "shutter-encoder", "main-workspace", "https://www.shutterencoder.com/wp-content/uploads/2025/06/Main.png"),
    ("media", "shutter-encoder", "settings", "https://www.shutterencoder.com/wp-content/uploads/2025/06/Settings.png"),
    ("media", "shutter-encoder", "queue", "https://www.shutterencoder.com/wp-content/uploads/2024/04/FileAttente.png"),

    # Office: LibreOffice native document surfaces. Microsoft Office remains a
    # documented secondary interaction reference because its support image CDN
    # does not expose stable direct image URLs.
    ("office", "libreoffice", "writer-document", "https://www.libreoffice.org/media/screenshot_writer.png"),
    ("office", "libreoffice", "calc-sheet", "https://www.libreoffice.org/media/screenshot_calc.png"),
    ("office", "libreoffice", "impress-slides", "https://www.libreoffice.org/media/screenshot_impress.png"),
    ("office", "libreoffice", "draw-canvas", "https://www.libreoffice.org/media/screenshot_draw.png"),
    ("office", "libreoffice", "base-records", "https://www.libreoffice.org/media/screenshot_base.png"),
    ("office", "libreoffice", "math-editor", "https://www.libreoffice.org/media/screenshot_math.png"),

    # Text: VS Code search/replace/encoding and Notepad++ navigation dialog.
    ("text", "vscode", "advanced-find", "https://code.visualstudio.com/assets/docs/editing/codebasics/search-replace-advanced-options.png"),
    ("text", "vscode", "global-replace", "https://code.visualstudio.com/assets/docs/editing/codebasics/global-search-replace.png"),
    ("text", "vscode", "replace-results", "https://code.visualstudio.com/assets/docs/editing/codebasics/search-replace-example.png"),
    ("text", "vscode", "search-editor", "https://code.visualstudio.com/assets/docs/editing/codebasics/search-editor-overview.png"),
    ("text", "vscode", "encoding-selection", "https://code.visualstudio.com/assets/docs/editing/codebasics/encodingselection.png"),
    ("text", "notepad-plus-plus", "goto-dialog", "https://raw.githubusercontent.com/notepad-plus-plus/npp-usermanual/master/content/docs/images/goto.png"),
]

POWER_RENAME = [
    ("menu-entry", "https://learn.microsoft.com/en-us/windows/powertoys/images/powerrename/menu.png", None),
    ("configured-preview", "https://learn.microsoft.com/en-us/windows/powertoys/images/powerrename/demo.gif", 0.25),
    ("rename-preview", "https://learn.microsoft.com/en-us/windows/powertoys/images/powerrename/demo.gif", 0.65),
    ("regex-options", "https://learn.microsoft.com/en-us/windows/powertoys/images/powerrename/demo2.gif", 0.25),
    ("result-preview", "https://learn.microsoft.com/en-us/windows/powertoys/images/powerrename/demo2.gif", 0.70),
    ("advanced-renamer", "https://www.advancedrenamer.com/pic/screen_aren_4_16_win.png", None),
]


def download(url):
    request = Request(url, headers={"User-Agent": "ToolPlus-Devil-Acceptance/1.0"})
    with urlopen(request, timeout=60) as response:
        return response.read()


def select_frame(data, fraction):
    image = Image.open(io.BytesIO(data))
    frames = [frame.convert("RGB") for frame in ImageSequence.Iterator(image)]
    if not frames:
        raise ValueError("animated source contains no frames")
    index = min(len(frames) - 1, max(0, round((len(frames) - 1) * fraction)))
    return frames[index], index, len(frames)


def save_png(data, destination, fraction=None):
    if fraction is None:
        image = Image.open(io.BytesIO(data))
        frame_index = 0
        frame_count = getattr(image, "n_frames", 1)
        image.seek(0)
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    else:
        image, frame_index, frame_count = select_frame(data, fraction)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG", optimize=True)
    return image.width, image.height, frame_index, frame_count


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    preserved_local = []
    existing_manifest = TARGET / "ORIGINAL_MANIFEST.json"
    if existing_manifest.exists():
        preserved_local = [
            item for item in json.loads(existing_manifest.read_text("utf-8")).get("records", [])
            if item.get("sourceType") == "local-application-capture" and (ROOT / item["file"]).exists()
        ]
    records = []
    for category, product, state, url in STATIC:
        destination = TARGET / category / f"{category}-{product}-{state}.png"
        if destination.exists():
            with Image.open(destination) as existing:
                width, height = existing.size
            frame_index, frame_count = 0, 1
        else:
            payload = download(url)
            width, height, frame_index, frame_count = save_png(payload, destination)
        records.append(record(category, product, state, url, destination, width, height, frame_index, frame_count))
        print(f"CAPTURE {category} {product} {state} {width}x{height}", flush=True)
    for state, url, fraction in POWER_RENAME:
        destination = TARGET / "file" / f"file-{'advanced-renamer' if state == 'advanced-renamer' else 'powerrename'}-{state}.png"
        payload = download(url)
        width, height, frame_index, frame_count = save_png(payload, destination, fraction)
        product = "advanced-renamer" if state == "advanced-renamer" else "powerrename"
        records.append(record("file", product, state, url, destination, width, height, frame_index, frame_count))
        print(f"CAPTURE file {product} {state} {width}x{height}", flush=True)
    records.extend(preserved_local)
    manifest = {
        "schemaVersion": 1,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "productVersion": VERSION,
        "policy": "Actual official products or official documentation UI images only; no generated or Tool Plus images.",
        "count": len(records),
        "categories": {category: sum(item["category"] == category for item in records) for category in sorted({item["category"] for item in records})},
        "records": records,
    }
    (TARGET / "ORIGINAL_MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
    if len(records) < 36 or any(count < 6 for count in manifest["categories"].values()):
        raise AssertionError(manifest["categories"])
    print(f"PASS UI research originals {len(records)} images across {len(manifest['categories'])} categories")


def record(category, product, state, url, destination, width, height, frame_index, frame_count):
    return {
        "category": category,
        "product": product,
        "state": state,
        "sourceUrl": url,
        "accessedDate": time.strftime("%Y-%m-%d"),
        "file": str(destination.relative_to(ROOT)).replace("\\", "/"),
        "width": width,
        "height": height,
        "frameIndex": frame_index,
        "sourceFrameCount": frame_count,
        "sha256": sha256(destination),
    }


if __name__ == "__main__":
    main()
