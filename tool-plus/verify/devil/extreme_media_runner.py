#!/usr/bin/env python3
"""Run every local media tool against a real declared-boundary media sample."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import matrix_runner as matrix
import report_identity


LEVEL = "L3"
MEDIA_CATEGORIES = {"视频工具", "音频工具"}
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL / "media-boundary"
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / "media-boundary"
LOG_ROOT = matrix.LOG_ROOT / LEVEL / "media-boundary"
FFMPEG = matrix.ROOT / "tools" / "ffmpeg" / "ffmpeg.exe"


def run_ffmpeg(arguments: list[str], timeout: int = 600) -> None:
    completed = subprocess.run(
        [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", *arguments],
        capture_output=True,
        timeout=timeout,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.decode("utf-8", errors="replace")[-2000:])


def make_samples() -> dict[str, Path]:
    SAMPLE_ROOT.mkdir(parents=True, exist_ok=True)
    spatial = SAMPLE_ROOT / "video-3840x2160-6s.mp4"
    duration = SAMPLE_ROOT / "video-160x90-600s.mp4"
    audio = SAMPLE_ROOT / "audio-600s.m4a"
    if not spatial.exists():
        run_ffmpeg([
            "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
            "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", str(spatial),
        ])
    if not duration.exists():
        run_ffmpeg([
            "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=1",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
            "-t", "600", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "48k", "-shortest", str(duration),
        ])
    if not audio.exists():
        run_ffmpeg([
            "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
            "-t", "600", "-c:a", "aac", "-b:a", "64k", str(audio),
        ])
    return {"spatial": spatial, "duration": duration, "audio": audio}


def inputs_for(tool: dict, samples: dict[str, Path]) -> tuple[list[str], str]:
    key = tool["key"]
    spatial_keys = {
        "video-text-watermark", "video-image-watermark", "video-crop", "video-resize",
        "video-frame-rate", "video-bitrate", "video-trim", "audio-to-mp4-cover",
    }
    if tool["category"] == "音频工具":
        source = samples["audio"]
        if key == "audio-merge":
            return [str(source), str(source)], "600-second-duration-boundary"
        if key == "audio-to-mp4-cover":
            return [str(source), matrix.sample("image.png")], "600-second-duration-boundary"
        return [str(source)], "600-second-duration-boundary"
    source = samples["spatial"] if key in spatial_keys else samples["duration"]
    boundary = "3840x2160-spatial-boundary" if source == samples["spatial"] else "600-second-duration-boundary"
    if key == "video-image-watermark":
        return [str(source), matrix.sample("image.png")], boundary
    if key == "video-merge":
        return [str(source), str(source)], boundary
    return [str(source)], boundary


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    samples = make_samples()
    tools = [tool for tool in matrix.CATALOG if tool["category"] in MEDIA_CATEGORIES]
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    records = []
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        log_path = LOG_ROOT / f"{key}.json"
        if os.environ.get("L3_MEDIA_RESUME") == "1" and log_path.exists():
            prior = json.loads(log_path.read_text("utf-8"))
            if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                records.append(prior)
                print(f"SKIP L3-MEDIA {index:02d}/{len(tools)} {key}", flush=True)
                continue
        inputs, boundary = inputs_for(tool, samples)
        before = {value: matrix.sha256(value) for value in set(inputs)}
        output_dir = OUTPUT_ROOT / key
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        options = matrix.default_options(tool, "")
        if key == "video-preview-grid":
            options["interval"] = "60"
        request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": options}
        execution = matrix.run_request(request, min(1800, int(tool.get("timeoutSeconds", 1800))))
        record = {
            "caseId": f"{key}:L3-limit", "level": LEVEL, "tool": key,
            "declaredLimits": tool.get("limits") or {}, "actualBoundary": boundary,
            "inputHashesBefore": before,
            "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:], "oracles": [], "result": "FAIL",
        }
        complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("媒体边界任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("媒体边界任务没有输出")
            record["oracles"] = [{"path": output, **matrix.validate_file(output)} for output in outputs]
            record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
            after = {value: matrix.sha256(value) for value in set(inputs)}
            if before != after:
                raise AssertionError("媒体源文件哈希发生变化")
            record["inputHashesAfter"] = after
            record["outputCount"] = len(outputs)
            record["result"] = "PASS"
            complete = True
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        report_identity.finalize_record(record, tool, oracle_complete=complete, root=matrix.ROOT)
        report_identity.write_evidence(log_path, record)
        records.append(record)
        suffix = f": {record.get('error')}" if record["result"] == "FAIL" else ""
        print(f"{record['result']} L3-MEDIA {index:02d}/{len(tools)} {key}{suffix}", flush=True)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="MEDIA-DECLARED-BOUNDARY")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_MEDIA_REPORT.json", report)
    print(f"L3 MEDIA SUMMARY {report['passed']}/{report['total']} pass", flush=True)
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
