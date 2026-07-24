#!/usr/bin/env python3
"""Execute all Office tools at their declared structural boundary."""

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
OFFICE_CATEGORIES = {"Word 工具", "Excel 工具", "PPT 工具"}
BOUNDARY_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL / "office-boundary"
SOURCE_BY_CATEGORY = {
    "Word 工具": BOUNDARY_ROOT / "boundary-supported.docx",
    "Excel 工具": BOUNDARY_ROOT / "boundary-supported.xlsx",
    "PPT 工具": BOUNDARY_ROOT / "boundary-supported.pptx",
}


def native_validate(path: Path, timeout: int = 180) -> dict:
    command = [
        os.environ.get("TOOLPLUS_PYTHON", os.fspath(Path(os.sys.executable))),
        os.fspath(Path(__file__).with_name("native_office_validate.py")),
        os.fspath(path),
        "--timeout",
        str(timeout),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout * 2)
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise AssertionError(f"原生 Office 验证器无 JSON 输出: {completed.stderr[-1000:]}")
    evidence = json.loads(lines[-1])
    if completed.returncode != 0 or not evidence.get("passed"):
        raise AssertionError(f"原生 Office 验证失败: {json.dumps(evidence, ensure_ascii=False)[-2000:]}")
    return evidence


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    tools = [tool for tool in matrix.CATALOG if tool["category"] in OFFICE_CATEGORIES]
    output_root = matrix.OUTPUT_ROOT / LEVEL / "office-boundary"
    log_root = matrix.LOG_ROOT / LEVEL / "office-boundary"
    for folder in (output_root, log_root):
        folder.mkdir(parents=True, exist_ok=True)

    input_native = {}
    for category, source in SOURCE_BY_CATEGORY.items():
        input_native[category] = native_validate(source)

    replacement = Path(matrix.sample("image.png"))
    records = []
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        source = SOURCE_BY_CATEGORY[tool["category"]]
        inputs = [str(source), str(replacement)] if key.endswith("replace-images") else [str(source)]
        input_hashes_before = {value: matrix.sha256(value) for value in inputs}
        output_dir = output_root / key
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        request = {
            "tool": key,
            "inputs": inputs,
            "outputDir": str(output_dir),
            "options": matrix.default_options(tool, ""),
        }
        execution = matrix.run_request(request, int(tool.get("timeoutSeconds", 900)))
        record = {
            "caseId": f"{key}:L3-limit",
            "level": LEVEL,
            "tool": key,
            "category": tool["category"],
            "declaredLimits": tool["limits"],
            "inputPaths": inputs,
            "inputHashesBefore": input_hashes_before,
            "nativeInputValidation": input_native[tool["category"]],
            "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:],
            "oracles": [],
            "nativeOutputValidation": [],
            "result": "FAIL",
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("Office 声明边界任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("Office 声明边界任务没有输出")
            for output in outputs:
                evidence = matrix.validate_file(output)
                record["oracles"].append({"path": output, **evidence})
                if Path(output).suffix.lower() in {".docx", ".xlsx", ".pptx"}:
                    record["nativeOutputValidation"].append(native_validate(Path(output)))
            input_hashes_after = {value: matrix.sha256(value) for value in inputs}
            if input_hashes_before != input_hashes_after:
                raise AssertionError("Office 源输入哈希发生变化")
            record["inputHashesAfter"] = input_hashes_after
            record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
            record["outputCount"] = len(outputs)
            record["result"] = "PASS"
            oracle_complete = True
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        report_identity.write_evidence(log_root / f"{key}.json", record)
        records.append(record)
        suffix = f": {record.get('error')}" if record["result"] == "FAIL" else ""
        print(f"{record['result']} L3-OFFICE {index}/{len(tools)} {key}{suffix}", flush=True)

    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="OFFICE-DECLARED-BOUNDARY")
    report["waivedLevels"] = ["L4", "L5"]
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_OFFICE_REPORT.json", report)
    print(f"L3 OFFICE SUMMARY {report['passed']}/{report['total']} pass", flush=True)
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
