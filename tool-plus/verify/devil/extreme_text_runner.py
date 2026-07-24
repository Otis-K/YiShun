import codecs
import json
import os
from pathlib import Path
import shutil
import time

import extreme_pdf_runner
import matrix_runner as matrix
import report_identity


LEVEL = "L3"
SIZE_OVERRIDE = int(os.environ["L3_TEXT_SIZE"]) if os.environ.get("L3_TEXT_SIZE") else None
if SIZE_OVERRIDE is not None and (SIZE_OVERRIDE <= 0 or SIZE_OVERRIDE % 100):
    raise ValueError("L3_TEXT_SIZE 必须是 100 的正整数倍")
TAG = os.environ.get("L3_TEXT_TAG", "text-declared-limits")
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL / TAG
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / TAG
LOG_ROOT = matrix.LOG_ROOT / LEVEL / TAG


def make_source(size):
    if size <= 0 or size % 100:
        raise ValueError(f"文本声明上限必须是 100 的正整数倍: {size}")
    source_root = SAMPLE_ROOT / str(size)
    source_root.mkdir(parents=True, exist_ok=True)
    base = source_root / "large.txt"
    if not base.exists() or base.stat().st_size != size:
        prefix = "ToolPlus-L3-文本-1234567890".encode("utf-8")
        line = prefix + b" " * (99 - len(prefix)) + b"\n"
        if len(line) != 100:
            raise AssertionError(len(line))
        block = line * 10_000
        block_count = size // len(block)
        with base.open("wb") as stream:
            for index in range(block_count):
                stream.write(block)
                if index and index % max(1, block_count // 10) == 0:
                    print(f"GENERATE text {index * len(block)}/{size}", flush=True)
    paths = {"txt": base}
    for extension in ("md", "html"):
        target = source_root / f"large.{extension}"
        if target.exists():
            target.unlink()
        os.link(base, target)
        paths[extension] = target
    second = source_root / "large-second.txt"
    if second.exists():
        second.unlink()
    os.link(base, second)
    paths["second"] = second
    return paths


def validate_text(path):
    path = Path(path)
    if path.stat().st_size == 0:
        raise AssertionError("文本输出为空")
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
        try:
            with path.open("rb") as stream:
                while True:
                    block = stream.read(8 * 1024 * 1024)
                    if not block:
                        break
                    decoder.decode(block)
                decoder.decode(b"", final=True)
            return {"type": "text", "encoding": encoding, "bytes": path.stat().st_size, "fullyDecodedStreaming": True}
        except UnicodeError:
            continue
    raise AssertionError("输出无法按支持的文本编码完整解码")


def main():
    for folder in (SAMPLE_ROOT, OUTPUT_ROOT, LOG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    source_cache = {}
    requested = {item.strip() for item in os.environ.get("L3_TEXT_TOOLS", "").split(",") if item.strip()}
    tools = [tool for tool in matrix.CATALOG if tool["category"] == "文本工具" and (not requested or tool["key"] in requested)]
    missing = requested - {tool["key"] for tool in tools}
    if missing:
        raise ValueError(f"未知文本工具: {sorted(missing)}")
    records = []
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        declared_size = int((tool.get("limits") or {}).get("maxInputBytes") or 0)
        size = SIZE_OVERRIDE if SIZE_OVERRIDE is not None else declared_size
        if size <= 0:
            raise ValueError(f"{key} 缺少 maxInputBytes 声明")
        if size not in source_cache:
            source_cache[size] = make_source(size)
        sources = source_cache[size]
        source_hash = matrix.sha256(sources["txt"])
        lines = size // 100
        log_path = LOG_ROOT / f"{key}.json"
        if os.environ.get("L3_TEXT_RESUME") == "1" and log_path.exists():
            prior = json.loads(log_path.read_text(encoding="utf-8"))
            if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                records.append(prior)
                print(f"SKIP L3-TEXT {index:02d}/{len(tools)} {key} ({prior['result']})", flush=True)
                continue
        output_dir = OUTPUT_ROOT / key
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        primary = sources["md"] if key.startswith("markdown-") else (sources["html"] if key.startswith("html-") else sources["txt"])
        inputs = [str(primary), str(sources["second"])] if key == "merge-text" else [str(primary)]
        request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": matrix.default_options(tool, "")}
        execution = matrix.run_request(request, max(1800, int(tool.get("timeoutSeconds", 900))))
        record = {
            "caseId": f"{key}:L3-limit", "level": LEVEL, "tool": key,
            "scale": {
                "bytesPerInput": size,
                "linesPerInput": lines,
                "inputCount": len(inputs),
                "declaredMaxInputBytes": declared_size,
                "testedAtDeclaredLimit": size == declared_size,
            },
            "execution": {k: v for k, v in execution.items() if k not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:], "sourceHashBefore": source_hash,
            "result": "FAIL", "oracles": []
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError(f"{size} 字节文本任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("成功响应没有输出")
            for output in outputs:
                path = Path(output)
                oracle = extreme_pdf_runner.validate_pdf(path, True) if path.suffix.lower() == ".pdf" else validate_text(path)
                record["oracles"].append({"path": output, **oracle})
            record["sourceHashAfter"] = matrix.sha256(sources["txt"])
            if record["sourceHashAfter"] != source_hash:
                raise AssertionError("源文本哈希变化")
            record["outputCount"] = len(outputs)
            oracle_complete = True
            record["result"] = "PASS"
        except Exception as error:
            record["error"] = str(error)
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        records.append(record)
        report_identity.write_evidence(log_path, record)
        print(f"{record['result']} L3-TEXT {index:02d}/{len(tools)} {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
        shutil.rmtree(output_dir, ignore_errors=True)
    passed = sum(item["result"] == "PASS" for item in records)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="TEXT-declared-byte-limits")
    report_name = os.environ.get("L3_TEXT_REPORT", "L3_TEXT_REPORT.json")
    report_identity.write_evidence(matrix.ACCEPTANCE / report_name, report)
    print(f"L3 TEXT SUMMARY {passed}/{len(records)} pass", flush=True)
    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
