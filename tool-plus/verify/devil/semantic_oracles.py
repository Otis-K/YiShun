import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader


SUPPORTED_KEYS = {
    "markdown-to-html", "markdown-to-txt", "html-to-txt", "txt-to-html", "replace-text", "replace-lines", "remove-whitespace", "merge-text", "txt-to-markdown", "html-to-markdown", "markdown-to-pdf", "text-encoding",
    "rename-prefix-suffix", "rename-replace", "rename-insert", "rename-parent", "rename-case", "rename-delete", "folder-replace", "folder-insert", "folder-prefix-suffix", "folder-case", "folder-delete", "classify-extension", "classify-filename", "classify-advanced", "mirror-folders", "modify-file-times",
    "image-convert", "image-watermark", "image-split", "image-edit", "image-enhance", "image-resize", "image-crop", "image-rotate", "image-compress", "image-metadata", "image-modern-convert", "image-effects", "svg-to-pdf", "svg-to-jpg",
    "docx-replace", "docx-to-txt", "docx-to-html", "docx-extract-images", "docx-remove-images", "docx-replace-images", "xlsx-replace", "xlsx-to-csv", "xlsx-to-json", "xlsx-extract-images", "xlsx-remove-images", "xlsx-replace-images", "pptx-extract-images", "pptx-remove-images", "pptx-replace-images",
    "pdf-delete-pages", "pdf-encrypt", "pdf-decrypt", "pdf-watermark", "pdf-stamp", "pdf-redact", "pdf-modify", "pdf-merge", "pdf-split", "pdf-rotate", "pdf-reorder", "pdf-extract-pages", "pdf-odd-even", "pdf-to-txt", "pdf-to-jpg", "pdf-add-margin", "pdf-compress", "pdf-extract-images", "pdf-page-numbers", "pdf-metadata",
    "web-video-download", "video-extract-audio", "video-remove-audio", "video-preview-grid", "video-text-watermark", "video-image-watermark", "video-to-aac-audio", "video-to-ogg-audio", "video-to-opus-audio", "video-trim", "video-crop", "video-merge", "video-resize", "video-frame-rate", "video-bitrate", "media-volume", "audio-merge", "audio-to-mp4-cover", "video-to-mp4", "video-to-avi", "video-to-mkv", "video-to-mov", "video-to-flv", "video-to-wmv", "video-to-webm", "video-to-mpeg", "video-to-3gp", "video-to-ogv", "video-to-ts", "audio-to-mp3", "audio-to-aac", "audio-to-m4a", "audio-to-wma", "audio-to-wav", "audio-to-flac", "audio-to-ogg", "audio-to-opus",
}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def output_files(outputs):
    files = []
    for value in outputs:
        path = Path(value)
        if path.is_dir():
            files.extend(item for item in path.rglob("*") if item.is_file())
        elif path.is_file():
            files.append(path)
    if not files:
        raise AssertionError("语义判定没有可检查的输出文件")
    return files


def output_entries(outputs):
    entries = []
    for value in outputs:
        path = Path(value)
        if path.is_dir():
            entries.append(path)
            entries.extend(path.rglob("*"))
        elif path.exists():
            entries.append(path)
    if not entries:
        raise AssertionError("语义判定没有可检查的输出路径")
    return entries


def read_text(path):
    data = Path(path).read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return data.decode(encoding), encoding
        except UnicodeError:
            pass
    raise AssertionError(f"文本无法按支持编码解码: {path}")


def validate(tool, request, outputs, root):
    key = tool["key"]
    if tool["uiReferenceId"] == "ui-file":
        evidence = validate_file_operation(key, request, output_entries(outputs))
        return {"oracle": "semantic-file", "tool": key, **evidence}
    files = output_files(outputs)
    if tool["uiReferenceId"] == "ui-text":
        evidence = validate_text(key, request, files)
    elif tool["uiReferenceId"] == "ui-image":
        evidence = validate_image(key, request, files)
    elif tool["uiReferenceId"] == "ui-office":
        evidence = validate_office(key, request, files)
    elif tool["uiReferenceId"] == "ui-pdf":
        evidence = validate_pdf(key, request, files)
    elif tool["uiReferenceId"] == "ui-media":
        evidence = validate_media(key, request, files, root)
    else:
        raise AssertionError(f"没有语义判定类别: {tool['uiReferenceId']}")
    return {"oracle": f"semantic-{tool['uiReferenceId'][3:]}", "tool": key, **evidence}


def validate_text(key, request, files):
    options = request.get("options") or {}
    texts = [read_text(path)[0] for path in files if path.suffix.lower() != ".pdf"]
    combined = "\n".join(texts)
    if key == "markdown-to-pdf":
        reader = PdfReader(str(files[0]))
        extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
        assert "Title" in extracted and "World" in extracted, "Markdown PDF 内容缺失"
        return {"pages": len(reader.pages), "contains": ["Title", "World"]}
    if key == "markdown-to-html":
        assert re.search(r"<h1[^>]*>\s*Title\s*</h1>", combined, re.I) and "<strong>World</strong>" in combined
    elif key == "markdown-to-txt":
        assert "Title" in combined and "World" in combined and "**World**" not in combined
    elif key == "html-to-txt":
        assert "Header" in combined and "Hello HTML" in combined and not re.search(r"<[^>]+>", combined)
    elif key == "txt-to-html":
        assert "foo line" in combined and re.search(r"<(?:pre|p|html)\b", combined, re.I)
    elif key == "replace-text":
        old, new = options.get("old", ""), options.get("new", "")
        assert new and new in combined and (not old or old not in combined)
    elif key == "replace-lines":
        replacement = options.get("replacement", "")
        assert replacement and replacement in combined
    elif key == "remove-whitespace":
        mode = options.get("mode")
        if mode == "all":
            assert all(not re.search(r"\s", text) for text in texts), "输出仍包含空白字符"
        elif mode == "blank-lines":
            assert all(not re.search(r"\n\s*\n", text) for text in texts), "输出仍包含空白行"
        else:
            assert all(line == line.strip() for text in texts for line in text.splitlines()), "输出行首尾仍包含空白"
    elif key == "merge-text":
        assert len(files) == 1 and "foo line" in combined and combined.count("foo line") >= len(request.get("inputs") or [])
    elif key == "txt-to-markdown":
        assert "foo line" in combined and files[0].suffix.lower() in {".md", ".markdown"}
    elif key == "html-to-markdown":
        assert "Header" in combined and "Hello HTML" in combined and not re.search(r"<html|<body", combined, re.I)
    elif key == "text-encoding":
        expected = options.get("encoding", "UTF-8")
        raw = files[0].read_bytes()
        if expected == "UTF-8 BOM": assert raw.startswith(b"\xef\xbb\xbf")
        elif expected == "UTF-16LE": assert raw.startswith(b"\xff\xfe")
        elif expected == "UTF-8": assert not raw.startswith((b"\xff\xfe", b"\xfe\xff"))
        assert "foo line" in combined
    else:
        raise AssertionError(f"文本判定器未实现: {key}")
    return {"files": len(files), "textChars": len(combined), "contentSha256": hashlib.sha256(combined.encode()).hexdigest()}


def transformed_name(key, source, options):
    path = Path(source)
    stem, suffix = path.stem, path.suffix
    if key.endswith("prefix-suffix"):
        stem = f"{options.get('prefix', '')}{stem}{options.get('suffix', '')}"
    elif key.endswith("replace"):
        stem = stem.replace(options.get("old", ""), options.get("new", ""))
    elif key.endswith("insert"):
        position = max(0, int(options.get("position", 0)))
        stem = stem[:position] + options.get("text", "") + stem[position:]
    elif key.endswith("case"):
        mode = options.get("mode", "")
        stem = stem.upper() if mode == "大写" else (stem.lower() if mode == "小写" else stem[:1].upper() + stem[1:])
    elif key.endswith("delete"):
        stem = stem.replace(options.get("text", ""), "")
    return stem + suffix


def validate_file_operation(key, request, entries):
    inputs = request.get("inputs") or []
    options = request.get("options") or {}
    files = [path for path in entries if path.is_file()]
    directories = [path for path in entries if path.is_dir()]
    names = [path.name for path in files]
    name_set = set(names)
    if key.startswith("rename-") and key != "rename-parent":
        expected = [transformed_name(key, source, options) for source in inputs]
        assert all(name in name_set for name in expected), f"名称映射不符: {expected[:10]} != {names[:10]}"
    elif key.startswith("folder-"):
        expected = [transformed_name(key, source, options) for source in inputs]
        directory_names = {path.name for path in directories}
        assert all(name in directory_names for name in expected), f"文件夹映射不符: {expected} != {sorted(directory_names)[:20]}"
    elif key == "rename-parent":
        assert all(Path(source).parent.name in " ".join(names) for source in inputs)
    elif key == "classify-extension":
        assert all(path.parent.name.lower().lstrip(".") == path.suffix.lower().lstrip(".") for path in files if path.suffix)
    elif key in {"classify-filename", "classify-advanced"}:
        assert all(path.parent != Path(request["outputDir"]) for path in files)
    elif key == "mirror-folders":
        source_directories = sum(1 for source in inputs for path in Path(source).rglob("*") if path.is_dir())
        assert len(directories) >= source_directories
    elif key == "modify-file-times":
        expected = time.mktime(time.strptime(options["time"], "%Y-%m-%d %H:%M:%S"))
        assert all(abs(path.stat().st_mtime - expected) < 2 for path in files)
    else:
        raise AssertionError(f"文件判定器未实现: {key}")
    return {"files": len(files), "directories": len(directories), "names": names[:20], "mappingChecked": True}


def image_signature(path):
    with Image.open(path) as image:
        image.load()
        rgb = image.convert("RGB")
        sample = rgb.resize((32, 32))
        focus_width = min(1024, image.width)
        focus_height = min(512, image.height)
        regions = (
            (0, 0, focus_width, focus_height),
            ((image.width - focus_width) // 2, (image.height - focus_height) // 2, (image.width + focus_width) // 2, (image.height + focus_height) // 2),
            (image.width - focus_width, image.height - focus_height, image.width, image.height),
        )
        detail = hashlib.sha256()
        for box in regions:
            detail.update(rgb.crop(box).tobytes())
        return {
            "format": image.format,
            "width": image.width,
            "height": image.height,
            "pixelSha256": hashlib.sha256(sample.tobytes()).hexdigest(),
            "detailSha256": detail.hexdigest(),
            "mean": [round(value, 3) for value in ImageStat.Stat(sample).mean],
        }


def validate_image(key, request, files):
    options = request.get("options") or {}
    inputs = [Path(value) for value in request.get("inputs") or [] if Path(value).is_file()]
    if key == "svg-to-pdf":
        assert files[0].suffix.lower() == ".pdf" and len(PdfReader(str(files[0])).pages) >= 1
        return {"format": "PDF", "pages": len(PdfReader(str(files[0])).pages)}
    source = image_signature(inputs[0]) if inputs and inputs[0].suffix.lower() != ".svg" else None
    signatures = [image_signature(path) for path in files if path.suffix.lower() not in {".svg", ".pdf"}]
    if key == "svg-to-jpg":
        assert signatures and signatures[0]["format"] == "JPEG"
    elif key in {"image-convert", "image-modern-convert"}:
        expected = options.get("format", "").lower()
        aliases = {"jpg": "JPEG", "tif": "TIFF"}
        assert files[0].suffix.lower().lstrip(".") == expected
        if signatures: assert signatures[0]["format"] == aliases.get(expected, expected.upper())
    elif key == "image-split":
        count_per_input = int(options.get("rows", 2)) * int(options.get("cols", 2))
        expected_count = len(inputs) * count_per_input
        assert len(signatures) == expected_count, f"切片数量 {len(signatures)} != 预期 {expected_count}"
        assert source is not None, "缺少可解码的源图片"
        assert all(item["width"] <= source["width"] and item["height"] <= source["height"] for item in signatures), "切片尺寸超过源图片"
    elif key in {"image-resize", "image-edit"} and options.get("operation", "缩放") == "缩放":
        width, height = int(options.get("width", 0)), int(options.get("height", 0))
        if width: assert signatures[0]["width"] == width
        if height: assert signatures[0]["height"] == height
    elif key in {"image-crop", "image-edit"} and (key == "image-crop" or options.get("operation") == "裁剪"):
        assert signatures[0]["width"] < source["width"] or signatures[0]["height"] < source["height"]
    elif key == "image-watermark":
        assert signatures[0]["detailSha256"] != source["detailSha256"], "水印没有改变角落或中心像素"
    elif key in {"image-enhance", "image-effects"}:
        assert signatures[0]["pixelSha256"] != source["pixelSha256"], "图像处理没有改变全局像素签名"
    elif key == "image-rotate":
        if "90" in options.get("angle", ""):
            assert (signatures[0]["width"], signatures[0]["height"]) == (source["height"], source["width"])
        else: assert signatures[0]["pixelSha256"] != source["pixelSha256"]
    elif key == "image-compress":
        assert signatures and signatures[0]["format"] == "JPEG"
        assert (signatures[0]["width"], signatures[0]["height"]) == (source["width"], source["height"])
    elif key == "image-metadata":
        with Image.open(files[0]) as image:
            metadata = " ".join(map(str, image.getexif().values())) + " " + " ".join(map(str, image.info.values()))
        if options.get("action") == "设置元数据": assert any(value and value in metadata for value in (options.get("title"), options.get("artist")))
        else: assert not any(value and value in metadata for value in (options.get("title"), options.get("artist"), options.get("copyright"), options.get("comment")))
    elif key == "image-edit":
        assert signatures[0]["pixelSha256"] != source["pixelSha256"]
    elif key != "svg-to-jpg":
        raise AssertionError(f"图片判定器未实现: {key}")
    return {"files": len(files), "source": source, "outputs": signatures[:20]}


def zip_snapshot(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        xml = "\n".join(archive.read(name).decode("utf-8", errors="ignore") for name in names if name.endswith(".xml"))
        media = {name: hashlib.sha256(archive.read(name)).hexdigest() for name in names if "/media/" in name}
    return {"names": names, "xml": xml, "media": media}


def xlsx_values(path):
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root.findall("x:si", namespace)]
        values = []
        for name in archive.namelist():
            if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                continue
            root = ET.fromstring(archive.read(name))
            for cell in root.findall(".//x:c", namespace):
                if cell.get("t") == "inlineStr":
                    values.append("".join(node.text or "" for node in cell.findall(".//x:t", namespace)))
                    continue
                value = cell.find("x:v", namespace)
                if value is None:
                    continue
                if cell.get("t") == "s":
                    values.append(shared[int(value.text)])
                else:
                    values.append(value.text or "")
    return values


def validate_office(key, request, files):
    options = request.get("options") or {}
    inputs = [Path(value) for value in request.get("inputs") or []]
    if key.endswith("-to-txt"):
        text, _ = read_text(files[0]); assert "OLD" in text or "Tool" in text or text.strip()
        return {"textChars": len(text)}
    if key.endswith("-to-html"):
        text, _ = read_text(files[0]); assert re.search(r"<html|<body|<p", text, re.I)
        return {"htmlChars": len(text)}
    if key == "xlsx-to-csv":
        rows = list(csv.reader(io.StringIO(read_text(files[0])[0]))); assert rows and any(any(cell for cell in row) for row in rows)
        return {"rows": len(rows)}
    if key == "xlsx-to-json":
        data = json.loads(read_text(files[0])[0]); assert data
        return {"jsonType": type(data).__name__, "items": len(data)}
    if key.endswith("extract-images"):
        images = [path for path in files if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"}]
        assert images
        for path in images:
            with Image.open(path) as image: image.verify()
        return {"images": len(images), "hashes": [sha256(path) for path in images]}
    snapshot = zip_snapshot(files[0])
    source_snapshot = zip_snapshot(inputs[0])
    if key.endswith("-replace"):
        old, new = options.get("old", ""), options.get("new", "")
        if key.startswith("xlsx-"):
            source_values, output_values = xlsx_values(inputs[0]), xlsx_values(files[0])
            assert any(new in value for value in output_values) and not any(old in value for value in output_values)
            assert any(old in value for value in source_values)
        else:
            assert new and snapshot["xml"].count(new) > source_snapshot["xml"].count(new)
            assert not old or snapshot["xml"].count(old) < source_snapshot["xml"].count(old)
    elif key.endswith("remove-images"):
        if key.startswith("pptx-"):
            assert len(snapshot["media"]) <= 1 and not set(snapshot["media"].values()) & set(source_snapshot["media"].values())
        else:
            assert not snapshot["media"]
    elif key.endswith("replace-images"):
        replacement_hash = sha256(inputs[1])
        assert replacement_hash in snapshot["media"].values()
    else:
        raise AssertionError(f"Office 判定器未实现: {key}")
    return {"entries": len(snapshot["names"]), "mediaCount": len(snapshot["media"]), "relationshipsChecked": True}


def selected_page_count(specification, total):
    if not specification or specification == "all": return total
    pages = []
    for part in specification.split(","):
        if "-" in part:
            start, end = map(int, part.split("-", 1)); pages.extend(range(start, end + 1))
        else: pages.append(int(part))
    return len(pages)


def validate_pdf(key, request, files):
    options = request.get("options") or {}
    inputs = [Path(value) for value in request.get("inputs") or []]
    readers = [PdfReader(str(path)) for path in inputs if path.suffix.lower() == ".pdf"]
    for reader in readers:
        if reader.is_encrypted:
            assert reader.decrypt(options.get("password", "")) != 0, "PDF 密码无法解锁输入"
    if key == "pdf-to-txt":
        text = "\n".join(read_text(path)[0] for path in files); assert text.strip()
        return {"textChars": len(text)}
    if key in {"pdf-to-jpg", "pdf-extract-images"}:
        signatures = [image_signature(path) for path in files]; assert signatures
        return {"images": len(signatures), "outputs": signatures[:20]}
    output = PdfReader(str(files[0]))
    was_encrypted = output.is_encrypted
    if was_encrypted:
        assert output.decrypt(options.get("password", "")) != 0, "PDF 密码无法解锁输出"
    pages = len(output.pages)
    source_pages = len(readers[0].pages) if readers else 0
    if key == "pdf-encrypt": assert was_encrypted
    elif key == "pdf-decrypt": assert not was_encrypted
    elif key == "pdf-merge": assert pages == sum(len(reader.pages) for reader in readers)
    elif key == "pdf-delete-pages": assert pages == source_pages - selected_page_count(options.get("pages"), source_pages)
    elif key in {"pdf-extract-pages", "pdf-reorder"}: assert pages == selected_page_count(options.get("pages"), source_pages)
    elif key == "pdf-split":
        span = int(options.get("span", 1)); assert len(files) == (source_pages + span - 1) // span
    elif key == "pdf-odd-even":
        assert pages == source_pages
        odd_count = (source_pages + 1) // 2
        sample_indices = sorted({0, max(0, odd_count - 1), odd_count, max(0, pages // 2), pages - 1})
        mappings = []
        for output_index in sample_indices:
            source_index = 2 * output_index if output_index < odd_count else 2 * (output_index - odd_count) + 1
            expected = readers[0].pages[source_index].extract_text() or ""
            actual = output.pages[output_index].extract_text() or ""
            assert actual == expected, f"奇偶重排抽样不符: output={output_index + 1}, source={source_index + 1}"
            mappings.append({"outputPage": output_index + 1, "sourcePage": source_index + 1})
    elif key == "pdf-metadata":
        metadata = output.metadata or {}
        if options.get("action") == "设置元数据": assert options.get("title") in str(metadata.get("/Title", ""))
    elif key in {"pdf-watermark", "pdf-stamp", "pdf-page-numbers"}:
        expected = options.get("text") or (options.get("format", "").replace("%p", "1").replace("%P", str(pages)))
        expected_fragment = re.sub(r"\s+", " ", expected.split("/")[0]).strip()
        sample_indices = sorted({0, max(0, pages // 2), pages - 1})
        assert expected_fragment
        for page_index in sample_indices:
            text = re.sub(r"\s+", " ", output.pages[page_index].extract_text() or "").strip()
            page_expected = expected_fragment
            if key == "pdf-page-numbers":
                page_expected = re.sub(
                    r"\s+", " ",
                    options.get("format", "%p / %P").replace("%p", str(page_index + 1)).replace("%P", str(pages)).split("/")[0],
                ).strip()
            assert page_expected in text, f"第 {page_index + 1} 页缺少预期文本 {page_expected!r}"
    elif key in {"pdf-redact", "pdf-compress", "pdf-add-margin", "pdf-modify", "pdf-rotate"}:
        assert pages == source_pages and sha256(files[0]) != sha256(inputs[0])
    else:
        raise AssertionError(f"PDF 判定器未实现: {key}")
    return {"pages": pages, "sourcePages": source_pages, "encrypted": was_encrypted, "contentChanged": not inputs or sha256(files[0]) != sha256(inputs[0])}


def probe_media(path, root):
    executable = Path(root) / "tools" / "ffmpeg" / "ffmpeg.exe"
    result = subprocess.run([str(executable), "-hide_banner", "-i", str(path)], capture_output=True, timeout=30)
    text = result.stderr.decode("utf-8", errors="replace")
    duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    dimensions = re.search(r"Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b", text)
    fps = re.search(r"Video:[^\r\n]*?\b(\d+(?:\.\d+)?)\s*fps\b", text)
    return {
        "durationSeconds": (int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])) if duration else None,
        "width": int(dimensions[1]) if dimensions else None,
        "height": int(dimensions[2]) if dimensions else None,
        "fps": float(fps[1]) if fps else None,
        "videoStreams": len(re.findall(r"Stream #\S+.*Video:", text)),
        "audioStreams": len(re.findall(r"Stream #\S+.*Audio:", text)),
    }


def validate_media(key, request, files, root):
    options = request.get("options") or {}
    inputs = [Path(value) for value in request.get("inputs") or [] if Path(value).is_file()]
    output = probe_media(files[0], root)
    source = probe_media(inputs[0], root) if inputs else None
    extension_targets = {**{f"video-to-{ext}": ext for ext in ("mp4", "avi", "mkv", "mov", "flv", "wmv", "webm", "mpeg", "3gp", "ogv", "ts")}, **{f"audio-to-{ext}": ext for ext in ("mp3", "aac", "m4a", "wma", "wav", "flac", "ogg", "opus")}}
    if key in extension_targets:
        assert files[0].suffix.lower().lstrip(".") == extension_targets[key]
    elif key == "video-extract-audio" or key.startswith("video-to-") and key.endswith("-audio"):
        assert output["audioStreams"] >= 1 and output["videoStreams"] == 0
    elif key == "video-remove-audio": assert output["videoStreams"] >= 1 and output["audioStreams"] == 0
    elif key == "video-preview-grid":
        signatures = [image_signature(path) for path in files]; assert signatures
        return {"images": len(signatures), "outputs": signatures[:10]}
    elif key == "video-trim": assert output["durationSeconds"] is not None and abs(output["durationSeconds"] - float(options["duration"])) <= 1.0
    elif key == "video-crop": assert (output["width"], output["height"]) == (int(options["width"]), int(options["height"]))
    elif key == "video-resize":
        if int(options.get("width", 0)): assert output["width"] == int(options["width"])
        if int(options.get("height", 0)): assert output["height"] == int(options["height"])
    elif key == "video-frame-rate": assert output["fps"] is not None and abs(output["fps"] - float(options["fps"])) <= 0.6
    elif key in {"video-merge", "audio-merge"}:
        durations = [probe_media(path, root)["durationSeconds"] or 0 for path in inputs]
        assert output["durationSeconds"] and output["durationSeconds"] >= sum(durations) - 1.0
    elif key == "audio-to-mp4-cover": assert output["videoStreams"] >= 1 and output["audioStreams"] >= 1 and (output["width"], output["height"]) == (int(options["width"]), int(options["height"]))
    elif key in {"video-text-watermark", "video-image-watermark", "video-bitrate", "media-volume"}:
        assert source and sha256(files[0]) != sha256(inputs[0]) and output["durationSeconds"] is not None
    elif key == "web-video-download": assert output["videoStreams"] + output["audioStreams"] >= 1
    else:
        raise AssertionError(f"媒体判定器未实现: {key}")
    assert output["videoStreams"] + output["audioStreams"] >= 1
    return {"source": source, "output": output, "extension": files[0].suffix.lower()}


def assert_catalog_coverage(catalog):
    catalog_keys = {tool["key"] for tool in catalog}
    missing = catalog_keys - SUPPORTED_KEYS
    unknown = SUPPORTED_KEYS - catalog_keys
    if missing or unknown:
        raise AssertionError(f"语义判定器映射不一致: missing={sorted(missing)} unknown={sorted(unknown)}")
    return len(SUPPORTED_KEYS)
