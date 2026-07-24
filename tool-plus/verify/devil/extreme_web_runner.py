#!/usr/bin/env python3
"""Run the public web downloader against a local 500 MB direct-media endpoint."""

from __future__ import annotations

import http.server
import json
import os
from pathlib import Path
import shutil
import socketserver
import threading

import matrix_runner as matrix
import report_identity


LEVEL = "L3"
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL / "web-boundary"
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / "web-boundary"
TARGET_BYTES = 500_000_000


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True

    def handle_error(self, _request, _client_address):
        pass


def make_boundary_file() -> Path:
    SAMPLE_ROOT.mkdir(parents=True, exist_ok=True)
    source = matrix.ACCEPTANCE / "samples" / LEVEL / "media-boundary" / "video-160x90-600s.mp4"
    if not source.exists():
        import extreme_media_runner
        source = extreme_media_runner.make_samples()["duration"]
    target = SAMPLE_ROOT / "public-video-500MB.mp4"
    if not target.exists() or target.stat().st_size != TARGET_BYTES:
        shutil.copyfile(source, target)
        with target.open("ab") as stream:
            stream.truncate(TARGET_BYTES)
    return target


def main() -> int:
    target = make_boundary_file()
    tool = next(item for item in matrix.CATALOG if item["key"] == "web-video-download")
    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    OUTPUT_ROOT.mkdir(parents=True)
    old_cwd = os.getcwd()
    os.chdir(SAMPLE_ROOT)
    server = QuietServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/{target.name}"
        request = {
            "tool": tool["key"], "inputs": [], "outputDir": str(OUTPUT_ROOT),
            "options": {"url": url, "quality": "最佳兼容质量", "maxSizeMB": "500"},
        }
        execution = matrix.run_request(request, min(1800, int(tool.get("timeoutSeconds", 1800))))
    finally:
        server.shutdown()
        server.server_close()
        os.chdir(old_cwd)
    record = {
        "caseId": "web-video-download:L3-limit", "level": LEVEL, "tool": tool["key"],
        "declaredLimits": tool.get("limits") or {}, "actualBoundary": {"servedBytes": TARGET_BYTES, "maxSizeMB": 500},
        "sourceHashBefore": matrix.sha256(target),
        "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
        "stderr": execution["stderr"][-2000:], "oracles": [], "result": "FAIL",
    }
    complete = False
    try:
        response = json.loads(execution["stdout"] or "{}")
        if execution["timedOut"]:
            raise AssertionError("500 MB 网页下载边界任务超时")
        if not response.get("ok"):
            raise AssertionError(matrix.response_error(response, execution))
        outputs = response.get("outputs") or []
        if not outputs:
            raise AssertionError("网页下载成功响应没有输出")
        record["oracles"] = [{"path": output, **matrix.validate_file(output)} for output in outputs]
        record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
        downloaded = Path(outputs[0])
        if downloaded.stat().st_size != TARGET_BYTES:
            raise AssertionError(f"下载字节数 {downloaded.stat().st_size} != 服务端 {TARGET_BYTES}")
        downloaded_hash = matrix.sha256(downloaded)
        if downloaded_hash != record["sourceHashBefore"]:
            raise AssertionError("下载文件 SHA-256 与服务端源文件不一致")
        record["downloadedBytes"] = downloaded.stat().st_size
        record["downloadedSha256"] = downloaded_hash
        if matrix.sha256(target) != record["sourceHashBefore"]:
            raise AssertionError("网页边界源文件哈希发生变化")
        record["sourceHashAfter"] = matrix.sha256(target)
        record["outputCount"] = len(outputs)
        record["result"] = "PASS"
        complete = True
    except Exception as error:
        record["error"] = f"{type(error).__name__}: {error}"
    report_identity.finalize_record(record, tool, oracle_complete=complete, root=matrix.ROOT)
    report = report_identity.build_report(matrix.ROOT, LEVEL, [record], suite="WEB-500MB-DIRECT-MEDIA")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_WEB_REPORT.json", report)
    print(f"L3 WEB SUMMARY {report['passed']}/{report['total']} pass" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
    return 0 if record["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
