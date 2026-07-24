import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import zipfile

import psutil
from PIL import Image
from pypdf import PdfReader
import report_identity
import semantic_oracles

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "backend" / "tool_catalog.json").read_text("utf-8"))
BACKEND = ROOT / "bin" / "toolplus-backend.exe"
SAMPLES = ROOT / "work" / "verify" / "samples"
ACCEPTANCE = ROOT / "work" / "acceptance-0.5.0" / "backend-devil"
OUTPUT_ROOT = ACCEPTANCE / "outputs"
LOG_ROOT = ACCEPTANCE / "logs"
METRICS_ROOT = ACCEPTANCE / "metrics"


class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def sample(name):
    return str(SAMPLES / name)


def default_options(tool, web_url):
    options = {}
    for param in tool.get("params", []):
        value = param.get("value", "")
        if value in (None, "") and param.get("choices"):
            value = param["choices"][0]
        options[param["name"]] = str(value if value is not None else "")
    overrides = {
        "replace-text": {"old": "foo", "new": "bar", "regex": "false"},
        "replace-lines": {"keyword": "keep", "replacement": "REPLACED"},
        "remove-whitespace": {"mode": "all"},
        "rename-prefix-suffix": {"prefix": "pre_", "suffix": "_suf"},
        "rename-replace": {"old": "plain", "new": "renamed"},
        "rename-insert": {"position": "2", "text": "_INSERT_"},
        "rename-case": {"mode": "大写"},
        "rename-delete": {"text": "ain"},
        "folder-replace": {"old": "Demo", "new": "Real"},
        "folder-insert": {"position": "4", "text": "_TEST_"},
        "folder-prefix-suffix": {"prefix": "PRE_", "suffix": "_POST"},
        "folder-case": {"mode": "大写"},
        "folder-delete": {"text": " Folder"},
        "classify-advanced": {"mode": "正则表达式", "pattern": "^([a-z]+)"},
        "image-convert": {"format": "jpg"},
        "image-edit": {"operation": "缩放", "width": "80", "height": "0"},
        "image-rotate": {"angle": "旋转 180°"},
        "image-metadata": {"action": "设置元数据", "title": "L0", "artist": "ToolPlus"},
        "image-modern-convert": {"format": "webp"},
        "image-effects": {"effect": "灰度", "amount": "25"},
        "docx-replace": {"old": "OLD", "new": "NEW"},
        "xlsx-replace": {"old": "OLD", "new": "NEW"},
        "pdf-redact": {"pages": "1", "style": "黑色遮盖"},
        "pdf-modify": {"operation": "旋转页面", "pages": "1", "angle": "顺时针 90°"},
        "pdf-rotate": {"pages": "1", "angle": "180°"},
        "pdf-page-numbers": {"position": "底部居中"},
        "pdf-metadata": {"action": "设置元数据", "title": "ToolPlus L0", "author": "验收"},
        "web-video-download": {"url": web_url, "quality": "最佳兼容质量", "maxSizeMB": "20"},
        "video-trim": {"start": "0", "duration": "1"},
        "video-resize": {"width": "320", "height": "0"},
        "video-bitrate": {"bitrate": "500"},
        "video-preview-grid": {"interval": "1"},
        "video-image-watermark": {"width": "80"},
        "audio-to-mp4-cover": {"width": "640", "height": "360", "color": "#1f2937"},
    }
    options.update(overrides.get(tool["key"], {}))
    return options


def inputs_for(tool, completed):
    key = tool["key"]
    if tool.get("inputKind") == "none":
        return []
    if key == "pdf-decrypt":
        prior = completed.get("pdf-encrypt", [])
        return prior[:1] if prior else [str(ROOT / "work" / "verify" / "outputs" / "pdf-encrypt" / "sample_encrypted.pdf")]
    if key.startswith("markdown-"):
        return [sample("note.md")]
    if key.startswith("html-"):
        return [sample("page.html")]
    if key in {"merge-text"}:
        return [sample("plain.txt"), sample("plain.txt")]
    if tool["category"] == "文本工具" or key.startswith("rename-") or key.startswith("classify-") or key == "modify-file-times":
        return [sample("plain.txt")]
    if key.startswith("folder-") or key == "mirror-folders":
        return [sample("Demo Folder")]
    if key in {"svg-to-pdf", "svg-to-jpg"}:
        return [sample("shape.svg")]
    if tool["category"] == "图片工具":
        return [sample("image.png")]
    if tool["category"] == "Word 工具":
        return [sample("doc.docx"), sample("image.png")] if key.endswith("replace-images") else [sample("doc.docx")]
    if tool["category"] == "Excel 工具":
        return [sample("book.xlsx"), sample("image.png")] if key.endswith("replace-images") else [sample("book.xlsx")]
    if tool["category"] == "PPT 工具":
        return [sample("slides.pptx"), sample("image.png")] if key.endswith("replace-images") else [sample("slides.pptx")]
    if tool["category"] == "PDF 工具":
        return [sample("sample.pdf"), sample("sample.pdf")] if key == "pdf-merge" else [sample("sample.pdf")]
    if key == "video-image-watermark":
        return [sample("real-video.mp4"), sample("image.png")]
    if key == "video-merge":
        return [sample("real-video.mp4"), sample("real-video.mp4")]
    if tool["category"] == "视频工具":
        return [sample("real-video.mp4")]
    if key == "audio-merge":
        return [sample("audio.wav"), sample("audio.wav")]
    if key == "audio-to-mp4-cover":
        return [sample("audio.wav"), sample("image.png")]
    if tool["category"] == "音频工具":
        return [sample("audio.wav")]
    return []


def process_metrics(proc):
    peak_rss = 0
    read_bytes = 0
    write_bytes = 0
    cpu_seconds = 0.0
    try:
        root = psutil.Process(proc.pid)
        processes = [root] + root.children(recursive=True)
        for item in processes:
            try:
                peak_rss += item.memory_info().rss
                cpu = item.cpu_times()
                cpu_seconds += cpu.user + cpu.system
                io = item.io_counters()
                read_bytes += io.read_bytes
                write_bytes += io.write_bytes
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except (psutil.NoSuchProcess, OSError):
        pass
    return peak_rss, cpu_seconds, read_bytes, write_bytes


def kill_tree(pid):
    try:
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
        for child in children:
            child.kill()
        parent.kill()
        psutil.wait_procs(children + [parent], timeout=2)
    except psutil.NoSuchProcess:
        pass


def run_request(req, timeout_seconds):
    started = time.time()
    try:
        proc = subprocess.Popen([str(BACKEND), "run"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        return {
            "pid": None,
            "exitCode": None,
            "timedOut": False,
            "spawnError": True,
            "durationMs": round((time.time() - started) * 1000),
            "peakRssBytes": 0,
            "cpuSeconds": 0,
            "readBytes": 0,
            "writeBytes": 0,
            "stdout": "",
            "stderr": f"{type(error).__name__}: {error}",
        }
    stdout_chunks = []
    stderr_chunks = []

    def drain(stream, chunks):
        for block in iter(lambda: stream.read(65536), b""):
            chunks.append(block)

    stdout_reader = threading.Thread(target=drain, args=(proc.stdout, stdout_chunks), daemon=True)
    stderr_reader = threading.Thread(target=drain, args=(proc.stderr, stderr_chunks), daemon=True)
    stdout_reader.start()
    stderr_reader.start()
    proc.stdin.write(json.dumps(req, ensure_ascii=False).encode("utf-8"))
    proc.stdin.close()
    peak_rss = cpu_seconds = read_bytes = write_bytes = 0
    timed_out = False
    while proc.poll() is None:
        metrics = process_metrics(proc)
        peak_rss = max(peak_rss, metrics[0])
        cpu_seconds = max(cpu_seconds, metrics[1])
        read_bytes = max(read_bytes, metrics[2])
        write_bytes = max(write_bytes, metrics[3])
        if time.time() - started > timeout_seconds:
            timed_out = True
            kill_tree(proc.pid)
            break
        time.sleep(0.1)
    stdout_reader.join(timeout=2)
    stderr_reader.join(timeout=2)
    stdout = b"".join(stdout_chunks).decode("utf-8", errors="replace")
    stderr = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    return {
        "pid": proc.pid,
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "durationMs": round((time.time() - started) * 1000),
        "peakRssBytes": peak_rss,
        "cpuSeconds": round(cpu_seconds, 4),
        "readBytes": read_bytes,
        "writeBytes": write_bytes,
        "stdout": stdout,
        "stderr": stderr,
    }


def response_error(response, execution, fallback="后端返回失败"):
    return response.get("error") or execution.get("stderr", "").strip() or (
        f"{fallback}，退出码 {execution.get('exitCode')}" if execution.get("exitCode") is not None else fallback
    )


def validate_file(path):
    path = Path(path)
    if not path.exists():
        raise AssertionError(f"输出不存在: {path}")
    if path.is_dir():
        descendants = list(path.rglob("*"))
        children = [item for item in descendants if item.is_file()]
        directories = [item for item in descendants if item.is_dir()]
        return {
            "type": "directory",
            "files": len(children),
            "directories": len(directories),
            "empty": not children and not directories,
        }
    if path.stat().st_size == 0:
        raise AssertionError(f"输出为空: {path}")
    ext = path.suffix.lower()
    if ext == ".pdf":
        reader = PdfReader(str(path))
        pdfcpu_args = [str(ROOT / "tools" / "pdfcpu.exe"), "validate"]
        if reader.is_encrypted:
            pdfcpu_args.extend(["--upw", "secret"])
        pdfcpu_args.append(str(path))
        pdfcpu = subprocess.run(pdfcpu_args, capture_output=True, timeout=30)
        if pdfcpu.returncode != 0:
            raise AssertionError("pdfcpu 校验失败: " + pdfcpu.stderr.decode(errors="replace"))
        if reader.is_encrypted:
            return {"type": "pdf", "encrypted": True, "validators": ["pypdf", "pdfcpu"]}
        if len(reader.pages) < 1:
            raise AssertionError("PDF 无页面")
        return {"type": "pdf", "pages": len(reader.pages), "validators": ["pypdf", "pdfcpu"]}
    if ext in {".docx", ".xlsx", ".pptx"}:
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            names = archive.namelist()
            if bad or "[Content_Types].xml" not in names:
                raise AssertionError(f"OOXML 结构损坏: {bad}")
        return {"type": "ooxml", "entries": len(names)}
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".tga", ".psd", ".avif"}:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return {"type": "image", "format": image.format, "width": image.width, "height": image.height, "frames": getattr(image, "n_frames", 1)}
    if ext == ".svg":
        text = path.read_text("utf-8")
        if "<svg" not in text:
            raise AssertionError("SVG 根元素缺失")
        return {"type": "svg"}
    if ext in {".mp4", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm", ".mpeg", ".mpg", ".3gp", ".ogv", ".ts", ".mp3", ".aac", ".m4a", ".wma", ".wav", ".flac", ".ogg", ".opus"}:
        probe = subprocess.run([str(ROOT / "tools" / "ffmpeg" / "ffmpeg.exe"), "-v", "error", "-i", str(path), "-f", "null", "-"], capture_output=True, timeout=120)
        if probe.returncode != 0:
            raise AssertionError("媒体解码失败: " + probe.stderr.decode(errors="replace")[-500:])
        return {"type": "media", "decoder": "ffmpeg"}
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            data.decode(encoding)
            return {"type": "text", "encoding": encoding, "bytes": len(data)}
        except UnicodeError:
            pass
    return {"type": "binary", "bytes": len(data)}


def flatten_outputs(outputs):
    files = []
    for value in outputs:
        item = Path(value)
        if item.is_dir():
            files.extend(child for child in item.rglob("*") if child.is_file())
        elif item.exists():
            files.append(item)
    return files


def run_l0(selected):
    for folder in (OUTPUT_ROOT / "L0", LOG_ROOT / "L0", METRICS_ROOT / "L0"):
        folder.mkdir(parents=True, exist_ok=True)
    os.chdir(SAMPLES)
    server = ReusableServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    web_url = f"http://127.0.0.1:{server.server_address[1]}/real-video.mp4"
    completed = {}
    records = []
    try:
        for index, tool in enumerate(CATALOG, 1):
            if selected and tool["key"] not in selected:
                continue
            key = tool["key"]
            out_dir = OUTPUT_ROOT / "L0" / key
            if out_dir.exists():
                shutil.rmtree(out_dir)
            out_dir.mkdir(parents=True)
            inputs = inputs_for(tool, completed)
            before = {value: sha256(value) for value in inputs if Path(value).is_file()}
            req = {"tool": key, "inputs": inputs, "outputDir": str(out_dir), "options": default_options(tool, web_url)}
            started_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            execution = run_request(req, min(int(tool.get("timeoutSeconds", 300)), 300))
            record = {
                "caseId": f"{key}:L0-baseline",
                "level": "L0",
                "tool": key,
                "category": tool["category"],
                "startedAt": started_at,
                "request": req,
                "inputHashesBefore": before,
                "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
                "stderr": execution["stderr"][-2000:],
                "outputs": [],
                "oracles": [],
                "result": "FAIL",
            }
            oracle_complete = False
            try:
                response = json.loads(execution["stdout"] or "{}")
                if execution["timedOut"]:
                    raise AssertionError("任务超时")
                if not response.get("ok"):
                    raise AssertionError(response_error(response, execution))
                outputs = response.get("outputs") or []
                if not outputs:
                    raise AssertionError("后端成功但未返回输出")
                after = {value: sha256(value) for value in inputs if Path(value).is_file()}
                if before != after:
                    raise AssertionError("原文件 SHA-256 发生变化")
                for output in outputs:
                    record["oracles"].append({"path": output, **validate_file(output)})
                output_files = flatten_outputs(outputs)
                record["outputs"] = [{"path": str(value), "bytes": value.stat().st_size, "sha256": sha256(value)} for value in output_files]
                record["inputHashesAfter"] = after
                record["semanticOracle"] = semantic_oracles.validate(tool, req, outputs, ROOT)
                oracle_complete = True
                record["result"] = "PASS"
                completed[key] = outputs
                print(f"PASS L0 {index:03d}/114 {key}", flush=True)
            except Exception as error:
                record["error"] = str(error)
                print(f"FAIL L0 {index:03d}/114 {key}: {error}", flush=True)
            report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=ROOT)
            report_identity.write_evidence(LOG_ROOT / "L0" / f"{key}.json", record)
            records.append(record)
    finally:
        server.shutdown()
        server.server_close()
    report = report_identity.build_report(ROOT, "L0", records, suite="baseline-semantic")
    report_identity.write_evidence(ACCEPTANCE / "L0_REPORT.json", report)
    print(f"L0 SUMMARY {report['passed']}/{report['total']} pass, {report['failed']} fail")
    return 0 if report["failed"] == 0 else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", default="L0", choices=["L0"])
    parser.add_argument("--tool", action="append")
    args = parser.parse_args()
    if not BACKEND.exists() or not SAMPLES.exists():
        raise SystemExit("backend or work/verify samples missing; run scripts/verify.ps1 first")
    return run_l0(set(args.tool or []))


if __name__ == "__main__":
    sys.exit(main())
