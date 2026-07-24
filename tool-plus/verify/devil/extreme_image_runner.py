import binascii
import json
import os
from pathlib import Path
import shutil
import struct
import time
import zlib

from PIL import Image

import matrix_runner as matrix
import report_identity


Image.MAX_IMAGE_PIXELS = None
LEVEL = "L3"
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / "image-16k"
LOG_ROOT = matrix.LOG_ROOT / LEVEL / "image-16k"


def png_chunk(stream, kind, payload):
    stream.write(struct.pack(">I", len(payload)))
    stream.write(kind)
    stream.write(payload)
    stream.write(struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF))


def make_streaming_png(path, width=16384, height=16384):
    if path.exists():
        with Image.open(path) as image:
            if image.size == (width, height):
                return
    path.parent.mkdir(parents=True, exist_ok=True)
    compressor = zlib.compressobj(level=6)
    with path.open("wb") as stream:
        stream.write(b"\x89PNG\r\n\x1a\n")
        png_chunk(stream, b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        horizontal = bytes((x // 64) % 256 for x in range(width))
        row_cache = {}
        for y in range(height):
            vertical = (y // 64) % 256
            if vertical not in row_cache:
                pixels = bytearray()
                for x, value in enumerate(horizontal):
                    pixels.extend((value, (value * 3 + vertical) % 256, (vertical * 5 + x // 257) % 256))
                row_cache[vertical] = b"\x00" + bytes(pixels)
            row = row_cache[vertical]
            block = compressor.compress(row)
            if block:
                png_chunk(stream, b"IDAT", block)
        tail = compressor.flush()
        if tail:
            png_chunk(stream, b"IDAT", tail)
        png_chunk(stream, b"IEND", b"")
    with Image.open(path) as image:
        image.verify()


def reset(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def validate_image(path):
    path = Path(path)
    if path.is_dir():
        return matrix.validate_file(path)
    with Image.open(path) as image:
        size = image.size
        frames = getattr(image, "n_frames", 1)
        image.load()
    return {"type": "image", "width": size[0], "height": size[1], "frames": frames, "fullyDecoded": True, "bytes": path.stat().st_size}


def main():
    for folder in (SAMPLE_ROOT, OUTPUT_ROOT, LOG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    source16 = SAMPLE_ROOT / "image-pattern-v2-16384x16384.png"
    source8 = SAMPLE_ROOT / "image-pattern-v2-8192x8192.png"
    make_streaming_png(source16)
    make_streaming_png(source8, 8192, 8192)
    tools = [tool for tool in matrix.CATALOG if tool["key"].startswith("image-")]
    records = []
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        log_path = LOG_ROOT / f"{key}.json"
        if os.environ.get("L3_IMAGE_RESUME") == "1" and log_path.exists():
            prior = json.loads(log_path.read_text(encoding="utf-8"))
            if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                records.append(prior)
                print(f"SKIP L3-IMAGE {index:02d}/{len(tools)} {key} (verified {prior['result']} log)", flush=True)
                continue
        limits = tool.get("limits") or {}
        use_8k = int(limits.get("maxWidth", 16384)) <= 8192 or int(limits.get("maxPixelsPerImage", 268435456)) <= 67108864
        source = source8 if use_8k else source16
        dimension = 8192 if use_8k else 16384
        source_hash = matrix.sha256(source)
        output_dir = OUTPUT_ROOT / key
        reset(output_dir)
        request = {"tool": key, "inputs": [str(source)], "outputDir": str(output_dir), "options": matrix.default_options(tool, "")}
        execution = matrix.run_request(request, max(1800, int(tool.get("timeoutSeconds", 900))))
        record = {
            "caseId": f"{key}:L3-limit", "level": LEVEL, "tool": key,
            "scale": {"width": dimension, "height": dimension, "pixels": dimension * dimension, "declaredBoundary": True},
            "execution": {k: v for k, v in execution.items() if k not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:], "sourceHashBefore": source_hash,
            "result": "FAIL", "oracles": []
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("16K 图片任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("成功响应没有输出")
            record["oracles"] = [{"path": value, **validate_image(value)} for value in outputs]
            record["sourceHashAfter"] = matrix.sha256(source)
            if record["sourceHashAfter"] != source_hash:
                raise AssertionError("源图片哈希变化")
            record["outputCount"] = len(outputs)
            record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
            oracle_complete = True
            record["result"] = "PASS"
        except Exception as error:
            record["error"] = str(error)
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        records.append(record)
        report_identity.write_evidence(log_path, record)
        print(f"{record['result']} L3-IMAGE {index:02d}/{len(tools)} {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
    passed = sum(item["result"] == "PASS" for item in records)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="IMAGE-declared-pixel-boundary")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_IMAGE_REPORT.json", report)
    print(f"L3 IMAGE SUMMARY {passed}/{len(records)} pass", flush=True)
    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
