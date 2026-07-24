from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import struct
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image
from pypdf import PdfReader


ROOT = Path(r"G:\tool-user-file\stress-0.4.0")
SAMPLES = ROOT / "samples"
OUTPUTS = ROOT / "outputs"
PROJECT = Path(__file__).resolve().parents[1]
FFMPEG = PROJECT / "tools" / "ffmpeg" / "ffmpeg.exe"
REPORT = ROOT / "DEEP_VERIFICATION.json"
checks: list[dict] = []


def record(name: str, ok: bool, detail: str) -> None:
    checks.append({"name": name, "status": "PASS" if ok else "FAIL", "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def require(condition: bool, name: str, detail: str) -> None:
    record(name, condition, detail)


def files(path: Path, suffix: str | None = None) -> list[Path]:
    result = [p for p in path.rglob("*") if p.is_file()]
    if suffix:
        result = [p for p in result if p.suffix.lower() == suffix]
    return sorted(result)


def only(path: Path, suffix: str | None = None) -> Path:
    found = files(path, suffix)
    if len(found) != 1:
        raise AssertionError(f"expected one file under {path}, found {len(found)}")
    return found[0]


def validate_relationships(path: Path) -> tuple[int, list[str]]:
    missing: list[str] = []
    relationships = 0
    with zipfile.ZipFile(path) as package:
        names = set(package.namelist())
        for rel_name in sorted(n for n in names if n.endswith(".rels")):
            root = ET.fromstring(package.read(rel_name))
            if rel_name == "_rels/.rels":
                source_dir = ""
            else:
                source_dir = posixpath.dirname(posixpath.dirname(rel_name))
            for rel in root:
                relationships += 1
                target = rel.attrib.get("Target", "")
                if rel.attrib.get("TargetMode", "").lower() == "external":
                    continue
                if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
                    continue
                normalized = posixpath.normpath(posixpath.join(source_dir, target.split("#", 1)[0])).lstrip("/")
                if normalized and normalized not in names:
                    missing.append(f"{rel_name} -> {normalized}")
    return relationships, missing


def office_checks(kind: str, source: Path) -> None:
    prefix = {"docx": "word/media/", "xlsx": "xl/media/", "pptx": "ppt/media/"}[kind]
    image_suffixes = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".avif", ".tga", ".emf", ".wmf", ".svg"}
    removed = only(OUTPUTS / f"{kind}-remove-images", f".{kind}")
    replaced = only(OUTPUTS / f"{kind}-replace-images", f".{kind}")
    for label, path in (("source", source), ("removed", removed), ("replaced", replaced)):
        rel_count, missing = validate_relationships(path)
        require(not missing, f"{kind}-{label}-relationships", f"{rel_count} relationships; missing={missing[:3]}")
        with zipfile.ZipFile(path) as package:
            media = sorted(n for n in package.namelist() if n.startswith(prefix) and Path(n).suffix.lower() in image_suffixes)
            if kind == "xlsx":
                worksheet_drawings = sum(
                    len(ET.fromstring(package.read(name)).findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}drawing"))
                    for name in package.namelist()
                    if re.match(r"xl/worksheets/sheet\d+\.xml$", name)
                )
                drawing_blips = sum(
                    len(ET.fromstring(package.read(name)).findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"))
                    for name in package.namelist()
                    if re.match(r"xl/drawings/drawing\d+\.xml$", name)
                )
                expected_drawings, expected_blips = ((0, 0) if label == "removed" else (4, 20))
                require(
                    (worksheet_drawings, drawing_blips) == (expected_drawings, expected_blips),
                    f"xlsx-{label}-drawing-anchors",
                    f"worksheet-drawings={worksheet_drawings}; picture-blips={drawing_blips}",
                )
            if label == "removed":
                with zipfile.ZipFile(source) as original:
                    original_media = sorted(n for n in original.namelist() if n.startswith(prefix) and Path(n).suffix.lower() in image_suffixes)
                if kind == "pptx":
                    slide_targets: set[str] = set()
                    for rel_name in package.namelist():
                        if not re.match(r"ppt/slides/_rels/slide\d+\.xml\.rels$", rel_name):
                            continue
                        root = ET.fromstring(package.read(rel_name))
                        for rel in root:
                            if rel.attrib.get("Type", "").endswith("/image") and rel.attrib.get("TargetMode", "").lower() != "external":
                                slide_targets.add(rel.attrib.get("Target", ""))
                    require(len(slide_targets) == 1 and len(media) < len(original_media), f"{kind}-removed-media", f"blank targets={slide_targets}; media={len(original_media)} -> {len(media)}")
                else:
                    require(len(media) == 0, f"{kind}-removed-media", f"media={len(media)}")
                image_rels = sum(package.read(n).count(b"relationships/image") for n in package.namelist() if n.endswith(".rels"))
                if kind == "pptx":
                    require(image_rels > 0, f"{kind}-removed-image-rels", f"relationships retained for stable shape/animation ids={image_rels}")
                else:
                    require(image_rels == 0, f"{kind}-removed-image-rels", f"image relationships={image_rels}")
            if label == "replaced":
                with zipfile.ZipFile(source) as original:
                    original_media = sorted(n for n in original.namelist() if n.startswith(prefix) and Path(n).suffix.lower() in image_suffixes)
                require(len(media) == len(original_media), f"{kind}-replaced-count", f"{len(original_media)} -> {len(media)}")
    manifest = only(OUTPUTS / f"{kind}-extract-images", ".json")
    data = json.loads(manifest.read_text("utf-8"))
    require(data["imageCount"] > 0 and len(data["images"]) == data["imageCount"], f"{kind}-manifest", f"images={data['imageCount']}")
    for item in data["images"]:
        exported = Path(item["outputFile"])
        digest = hashlib.sha256(exported.read_bytes()).hexdigest()
        if digest != item["sha256"]:
            raise AssertionError(f"manifest hash mismatch: {exported}")


def pdf_checks() -> None:
    source = SAMPLES / "image-heavy-80-pages.pdf"
    source_reader = PdfReader(str(source))
    require(len(source_reader.pages) == 80, "pdf-source-pages", "pages=80")
    for label in ("large-image-pdf-lossless", "large-image-pdf-strong"):
        output = only(OUTPUTS / "pdf-compress" / label, ".pdf")
        reader = PdfReader(str(output))
        require(len(reader.pages) == 80, f"pdf-compress-{label}-pages", f"pages={len(reader.pages)}")
        if label.endswith("strong"):
            require(output.stat().st_size <= source.stat().st_size, "pdf-strong-size", f"{source.stat().st_size} -> {output.stat().st_size}")
    numbered = only(OUTPUTS / "pdf-page-numbers", ".pdf")
    numbered_reader = PdfReader(str(numbered))
    require(len(numbered_reader.pages) == 80, "pdf-page-number-pages", f"pages={len(numbered_reader.pages)}")
    extracted = "\n".join((numbered_reader.pages[i].extract_text() or "") for i in (0, 79))
    require("Page 1" in extracted and "Page 80" in extracted, "pdf-page-number-text", extracted[-180:].replace("\n", " | "))
    metadata_pdf = only(OUTPUTS / "pdf-metadata", ".pdf")
    metadata = PdfReader(str(metadata_pdf)).metadata or {}
    require(metadata.get("/Title") == "ToolPlus 压力验收", "pdf-metadata-title", repr(metadata.get("/Title")))
    require(metadata.get("/Author") == "自动验收", "pdf-metadata-author", repr(metadata.get("/Author")))
    images = files(OUTPUTS / "pdf-extract-images")
    require(len(images) == 80, "pdf-extracted-images", f"images={len(images)}")


def image_checks() -> None:
    modern = {p.suffix.lower(): p for p in files(OUTPUTS / "image-modern-convert")}
    psd = modern[".psd"].read_bytes()
    height = struct.unpack(">I", psd[14:18])[0]
    width = struct.unpack(">I", psd[18:22])[0]
    require(psd[:4] == b"8BPS" and (width, height) == (3000, 2000), "image-psd-signature", f"{width}x{height}")
    svg = ET.fromstring(modern[".svg"].read_bytes())
    image_node = next(iter(svg))
    href = image_node.attrib.get("href", image_node.attrib.get("{http://www.w3.org/1999/xlink}href", ""))
    require(svg.attrib.get("width") == "3000" and svg.attrib.get("height") == "2000" and href.startswith("data:image/"), "image-svg-container", f"{svg.attrib.get('width')}x{svg.attrib.get('height')}")
    avif = modern[".avif"].read_bytes()[:64]
    require(b"ftyp" in avif and (b"avif" in avif or b"avis" in avif), "image-avif-signature", avif.hex()[:48])
    source_hash = hashlib.sha256((SAMPLES / "noise-3000x2000.png").read_bytes()).hexdigest()
    effect_files = files(OUTPUTS / "image-effects")
    require(len(effect_files) == 12, "image-effect-count", f"effects={len(effect_files)}")
    changed = sum(hashlib.sha256(p.read_bytes()).hexdigest() != source_hash for p in effect_files)
    require(changed >= 11, "image-effects-changed", f"changed={changed}; auto contrast may be a no-op for full-range pixels")
    transparent_outputs = [p for p in effect_files if "transparent-" in str(p.parent)]
    alpha_ranges = []
    for path in transparent_outputs:
        with Image.open(path) as image:
            alpha = image.convert("RGBA").getchannel("A")
            alpha_ranges.append(alpha.getextrema())
    require(
        len(alpha_ranges) == 3 and all(low == 0 and 0 < high <= 255 for low, high in alpha_ranges),
        "image-effects-alpha",
        f"alpha-ranges={alpha_ranges}",
    )


def media_info(path: Path) -> str:
    proc = subprocess.run([str(FFMPEG), "-hide_banner", "-i", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stderr


def media_checks() -> None:
    for tool, codec in (("video-to-aac-audio", "aac"), ("video-to-ogg-audio", "vorbis"), ("video-to-opus-audio", "opus")):
        text = media_info(only(OUTPUTS / tool))
        require("Audio:" in text and codec in text.lower() and "Video:" not in text, f"{tool}-stream", codec)
    crop = media_info(only(OUTPUTS / "video-crop"))
    require("1280x720" in crop, "video-crop-size", "1280x720")
    resized = media_info(only(OUTPUTS / "video-resize"))
    require("1280x720" in resized, "video-resize-size", "1280x720")
    fps = media_info(only(OUTPUTS / "video-frame-rate"))
    require(re.search(r"\b24(?:\.0+)? fps\b", fps) is not None, "video-frame-rate", "24 fps")
    for path in files(OUTPUTS / "audio-to-mp4-cover"):
        text = media_info(path)
        require("Video:" in text and "Audio:" in text, f"audio-cover-{path.parent.name}", "video+audio streams")


def classification_checks() -> None:
    modes = sorted(p for p in (OUTPUTS / "classify-advanced").iterdir() if p.is_dir())
    require(len(modes) == 9, "classification-mode-count", f"modes={len(modes)}")
    for mode in modes:
        count = len(files(mode))
        require(count == 10000, f"classification-{mode.name}", f"files={count}")


def main() -> int:
    try:
        stress = json.loads((ROOT / "STRESS_REPORT.json").read_text("utf-8"))
        require(stress["failed"] == 0 and stress["passed"] >= 60, "stress-report", f"{stress['passed']} passed, {stress['failed']} failed")
        classification_checks()
        image_checks()
        office_checks("docx", SAMPLES / "real-word-17-images.docx")
        office_checks("xlsx", SAMPLES / "large-excel-20-images.xlsx")
        office_checks("pptx", SAMPLES / "real-ppt-28-images.pptx")
        pdf_checks()
        media_checks()
    except Exception as exc:
        record("deep-verifier", False, f"{type(exc).__name__}: {exc}")
    payload = {"passed": sum(c["status"] == "PASS" for c in checks), "failed": sum(c["status"] == "FAIL" for c in checks), "checks": checks}
    REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    print(f"DEEP VERIFY: {payload['passed']} passed, {payload['failed']} failed")
    return 1 if payload["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
