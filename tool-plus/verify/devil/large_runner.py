import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

from pypdf import PdfReader, PdfWriter

import matrix_runner as matrix
import report_identity


LEVEL = "L2"
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL
LOG_ROOT = matrix.LOG_ROOT / LEVEL


def reset(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def clone(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def make_file_batch(source_name, extension, count, folder):
    reset(folder)
    source = Path(matrix.sample(source_name))
    paths = []
    for index in range(count):
        target = folder / f"item-{index:04d}{extension}"
        clone(source, target)
        paths.append(str(target))
    return paths


def make_folder_batch(count, folder):
    reset(folder)
    paths = []
    for index in range(count):
        target = folder / f"Demo Folder {index:04d}"
        target.mkdir()
        (target / "payload.txt").write_text(f"folder {index}\n", encoding="utf-8")
        paths.append(str(target))
    return paths


def make_pdf(path, pages=500):
    path.parent.mkdir(parents=True, exist_ok=True)
    source = PdfReader(matrix.sample("sample.pdf"))
    writer = PdfWriter()
    for index in range(pages):
        writer.add_page(source.pages[index % len(source.pages)])
    with path.open("wb") as stream:
        writer.write(stream)
    assert len(PdfReader(path).pages) == pages
    return str(path)


def make_4k(path):
    if path.exists():
        return str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = matrix.ROOT / "tools" / "ffmpeg" / "ffmpeg.exe"
    command = [
        str(ffmpeg), "-y", "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000", "-t", "1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
    return str(path)


def make_long_audio(path):
    if path.exists():
        return str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = matrix.ROOT / "tools" / "ffmpeg" / "ffmpeg.exe"
    command = [
        str(ffmpeg), "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "600", "-c:a", "pcm_s16le", str(path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
    return str(path)


def digest_inputs(inputs):
    digest = hashlib.sha256()
    files = []
    for value in inputs:
        path = Path(value)
        candidates = [path] if path.is_file() else sorted(item for item in path.rglob("*") if item.is_file())
        for item in candidates:
            files.append(item)
            digest.update(str(item).encode("utf-8"))
            digest.update(matrix.sha256(item).encode("ascii"))
    return digest.hexdigest(), len(files)


def inputs_for(tool, cache):
    key = tool["key"]
    category = tool["category"]
    target = SAMPLE_ROOT / key
    if tool.get("inputKind") == "none":
        return []
    if key.startswith("svg-to-"):
        return make_file_batch("shape.svg", ".svg", 100, target)
    if category == "文本工具":
        source, ext = ("note.md", ".md") if key.startswith("markdown-") else (("page.html", ".html") if key.startswith("html-") else ("plain.txt", ".txt"))
        return make_file_batch(source, ext, 1000, target)
    if category == "文件夹命名":
        return make_folder_batch(1000, target)
    if category in {"文件命名", "文件整理"}:
        if key == "mirror-folders":
            root = target / "root"
            reset(root)
            for index in range(1000):
                nested = root / f"dir-{index:04d}"
                nested.mkdir()
                (nested / "payload.txt").write_text(str(index), encoding="utf-8")
            return [str(root)]
        return make_file_batch("plain.txt", ".txt", 1000, target)
    if category == "图片工具":
        return make_file_batch("image.png", ".png", 1000, target)
    office = {
        "Word 工具": ("doc.docx", ".docx"),
        "Excel 工具": ("book.xlsx", ".xlsx"),
        "PPT 工具": ("slides.pptx", ".pptx"),
    }
    if category in office:
        source, ext = office[category]
        count = 1 if key.endswith("replace-images") else 100
        items = make_file_batch(source, ext, count, target)
        if key.endswith("replace-images"):
            replacement = target / "replacement.png"
            clone(Path(matrix.sample("image.png")), replacement)
            items.append(str(replacement))
        return items
    if category == "PDF 工具":
        if key == "pdf-decrypt" and cache.get("pdf500_encrypted"):
            return [cache["pdf500_encrypted"]]
        if "pdf500" not in cache:
            cache["pdf500"] = make_pdf(SAMPLE_ROOT / "shared" / "pages-500.pdf")
        pdf = cache["pdf500"]
        return [pdf, pdf] if key == "pdf-merge" else [pdf]
    if category in {"视频工具", "音频工具"}:
        media = cache["audio10m"] if category == "音频工具" else cache["media4k"]
        if key == "video-image-watermark":
            return [media, matrix.sample("image.png")]
        if key in {"video-merge", "audio-merge"}:
            return [media, media]
        if key == "audio-to-mp4-cover":
            return [media, matrix.sample("image.png")]
        return [media]
    return matrix.inputs_for(tool, {})


def main():
    for folder in (SAMPLE_ROOT, OUTPUT_ROOT, LOG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    cache = {
        "media4k": make_4k(SAMPLE_ROOT / "shared" / "media-4k.mp4"),
        "audio10m": make_long_audio(SAMPLE_ROOT / "shared" / "audio-10m.wav"),
    }
    os.chdir(Path(cache["media4k"]).parent)
    server = matrix.ReusableServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    web_url = f"http://127.0.0.1:{server.server_address[1]}/media-4k.mp4"
    records = []
    try:
        for index, tool in enumerate(matrix.CATALOG, 1):
            key = tool["key"]
            log_path = LOG_ROOT / f"{key}.json"
            if os.environ.get("L2_RESUME") == "1" and log_path.exists():
                prior = json.loads(log_path.read_text(encoding="utf-8"))
                if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                    scale = prior.setdefault("declaredScale", {})
                    if tool["category"] == "音频工具":
                        scale.pop("mediaResolution", None)
                        scale["audioDurationSeconds"] = 600
                    records.append(prior)
                    print(f"SKIP L2 {index:03d}/114 {key} (verified PASS log)", flush=True)
                    continue
            output_dir = OUTPUT_ROOT / key
            reset(output_dir)
            inputs = inputs_for(tool, cache)
            before_digest, input_file_count = digest_inputs(inputs)
            request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": matrix.default_options(tool, web_url)}
            execution = matrix.run_request(request, max(300, int(tool.get("timeoutSeconds", 300))))
            record = {
                "caseId": f"{key}:L2-large", "level": LEVEL, "tool": key,
                "category": tool["category"], "declaredScale": {
                    "inputPaths": len(inputs), "inputFiles": input_file_count,
                    "pdfPages": 500 if tool["category"] == "PDF 工具" else None,
                    "mediaResolution": "3840x2160" if tool["category"] in {"视频工具", "网页工具"} else None,
                    "audioDurationSeconds": 600 if tool["category"] == "音频工具" else None,
                },
                "execution": {k: v for k, v in execution.items() if k not in {"stdout", "stderr"}},
                "stderr": execution["stderr"][-2000:], "result": "FAIL", "oracles": [],
                "inputDigestBefore": before_digest,
            }
            oracle_complete = False
            try:
                response = json.loads(execution["stdout"] or "{}")
                if execution["timedOut"]:
                    raise AssertionError("大负载任务超时")
                if not response.get("ok"):
                    raise AssertionError(matrix.response_error(response, execution))
                outputs = response.get("outputs") or []
                if not outputs:
                    raise AssertionError("成功响应没有输出")
                for output in outputs:
                    record["oracles"].append({"path": output, **matrix.validate_file(output)})
                after_digest, _ = digest_inputs(inputs)
                record["inputDigestAfter"] = after_digest
                if before_digest != after_digest:
                    raise AssertionError("源输入聚合哈希发生变化")
                record["outputCount"] = len(outputs)
                record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
                oracle_complete = True
                record["result"] = "PASS"
                if key == "pdf-encrypt":
                    cache["pdf500_encrypted"] = outputs[0]
            except Exception as error:
                record["error"] = str(error)
            report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
            records.append(record)
            report_identity.write_evidence(log_path, record)
            print(f"{record['result']} L2 {index:03d}/114 {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
    finally:
        server.shutdown()
        server.server_close()
    passed = sum(item["result"] == "PASS" for item in records)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="large-load")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L2_REPORT.json", report)
    print(f"L2 SUMMARY {passed}/{len(records)} pass, {len(records)-passed} fail", flush=True)
    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
