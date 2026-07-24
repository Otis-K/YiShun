import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import time

import matrix_runner as matrix
import report_identity


def malformed_for(tool, root):
    category = tool["category"]
    key = tool["key"]
    if tool.get("inputKind") == "folders":
        folder = root / "empty-folder"
        folder.mkdir(parents=True, exist_ok=True)
        return str(folder)
    extensions = {
        "图片工具": ".png",
        "Word 工具": ".docx",
        "Excel 工具": ".xlsx",
        "PPT 工具": ".pptx",
        "PDF 工具": ".pdf",
        "视频工具": ".mp4",
        "音频工具": ".wav",
    }
    ext = extensions.get(category, ".txt")
    target = root / f"truncated{ext}"
    target.write_bytes(b"not-a-valid-format\x00\xff")
    return str(target)


def build_inputs(tool, primary, valid_inputs):
    key = tool["key"]
    if tool.get("inputKind") == "none":
        return []
    if key.endswith("replace-images") or key in {"video-image-watermark", "audio-to-mp4-cover"}:
        replacement = matrix.sample("image.png")
        return [primary, replacement]
    if key in {"merge-text", "pdf-merge", "video-merge", "audio-merge"}:
        return [primary, primary]
    return [primary]


def output_files(root):
    return [path for path in root.rglob("*") if path.is_file()]


def execute_subcase(tool, name, inputs, options, output_dir, must_fail):
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    before = {value: matrix.sha256(value) for value in inputs if Path(value).is_file()}
    request = {"tool": tool["key"], "inputs": inputs, "outputDir": str(output_dir), "options": options}
    execution = matrix.run_request(request, min(int(tool.get("timeoutSeconds", 300)), 30))
    record = {
        "name": name,
        "request": request,
        "execution": {key: value for key, value in execution.items() if key not in {"stdout", "stderr"}},
        "stderr": execution["stderr"][-1000:],
        "inputHashesBefore": before,
        "result": "FAIL",
        "oracles": [],
    }
    try:
        response = json.loads(execution["stdout"] or "{}")
        after = {value: matrix.sha256(value) for value in inputs if Path(value).is_file()}
        if before != after:
            raise AssertionError("破坏输入的原文件哈希发生变化")
        record["inputHashesAfter"] = after
        if execution["timedOut"]:
            raise AssertionError("异常输入导致任务超时")
        if must_fail:
            if response.get("ok"):
                raise AssertionError("缺失输入被静默报告为成功")
            if output_files(output_dir):
                raise AssertionError("失败后残留输出文件")
            record["expectedError"] = response.get("error", "")
        elif response.get("ok"):
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("异常输入返回成功但无输出")
            for output in outputs:
                record["oracles"].append({"path": output, **matrix.validate_file(output)})
        else:
            record["expectedError"] = response.get("error", "")
        record["result"] = "PASS"
    except Exception as error:
        record["error"] = str(error)
    return record


def main():
    sample_root = matrix.ACCEPTANCE / "samples" / "L4"
    output_root = matrix.OUTPUT_ROOT / "L4"
    log_root = matrix.LOG_ROOT / "L4"
    for folder in (sample_root, output_root, log_root):
        folder.mkdir(parents=True, exist_ok=True)
    os.chdir(matrix.SAMPLES)
    server = matrix.ReusableServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    invalid_url = "http://127.0.0.1:1/unreachable.mp4"
    records = []
    try:
        for index, tool in enumerate(matrix.CATALOG, 1):
            key = tool["key"]
            tool_samples = sample_root / key
            if tool_samples.exists():
                shutil.rmtree(tool_samples)
            tool_samples.mkdir(parents=True)
            options = matrix.default_options(tool, invalid_url)
            valid_inputs = matrix.inputs_for(tool, {})
            subcases = []
            if tool.get("inputKind") == "none":
                subcases.append(execute_subcase(tool, "unreachable-url", [], options, output_root / key / "unreachable-url", True))
            else:
                missing = str(tool_samples / "missing-input")
                subcases.append(execute_subcase(tool, "missing-input", build_inputs(tool, missing, valid_inputs), options, output_root / key / "missing-input", True))
                malformed = malformed_for(tool, tool_samples)
                subcases.append(execute_subcase(tool, "malformed-or-empty", build_inputs(tool, malformed, valid_inputs), options, output_root / key / "malformed", False))
            result = "PASS" if all(item["result"] == "PASS" for item in subcases) else "FAIL"
            record = {
                "caseId": f"{key}:L4-destructive",
                "level": "L4",
                "tool": key,
                "category": tool["category"],
                "result": result,
                "subcases": subcases,
            }
            report_identity.finalize_record(record, tool, oracle_complete=False, root=matrix.ROOT)
            records.append(record)
            report_identity.write_evidence(log_root / f"{key}.json", record)
            errors = [item.get("error") for item in subcases if item["result"] != "PASS"]
            print(f"{result} L4 {index:03d}/114 {key}{': ' + '; '.join(errors) if errors else ''}", flush=True)
    finally:
        server.shutdown()
        server.server_close()
    report = report_identity.build_report(matrix.ROOT, "L4", records, suite="destructive")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L4_REPORT.json", report)
    print(f"L4 SUMMARY {report['passed']}/{report['total']} pass, {report['failed']} fail")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
