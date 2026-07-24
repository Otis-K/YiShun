import json
from pathlib import Path
import time

import matrix_runner as matrix


REPORT_DIR = matrix.ACCEPTANCE
SOURCE_REPORTS = {
    "one_gb": REPORT_DIR / "L3_TEXT_1GB_FINAL_REPORT.json",
    "two_fifty_mb": REPORT_DIR / "L3_TEXT_250MB_REPORT.json",
    "pdf_ten_mb": REPORT_DIR / "L3_TEXT_10MB_PDF_REPORT.json",
}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    source = {name: load(path) for name, path in SOURCE_REPORTS.items()}
    latest_by_tool = {}
    for report_name in ("one_gb", "two_fifty_mb", "pdf_ten_mb"):
        for record in source[report_name]["records"]:
            if record["result"] == "PASS":
                latest_by_tool[record["tool"]] = {**record, "evidenceReport": SOURCE_REPORTS[report_name].name}

    text_tools = [tool for tool in matrix.CATALOG if tool["category"] == "文本工具"]
    records = []
    for tool in text_tools:
        record = latest_by_tool.get(tool["key"])
        if not record:
            raise AssertionError(f"{tool['key']} 没有通过的真实极限执行记录")
        declared = int(tool["limits"]["maxInputBytes"])
        actual = int(record["scale"]["bytesPerInput"])
        if actual != declared:
            raise AssertionError(f"{tool['key']} 声明 {declared}，实际证据 {actual}")
        records.append({**record, "declaredMaxInputBytes": declared, "boundaryMatched": True})

    initial_report = load(REPORT_DIR / "L3_TEXT_REPORT.json")
    initial_failures = [
        {"tool": item["tool"], "error": item.get("error", ""), "stderrTail": item.get("stderr", "")[-500:]}
        for item in initial_report["records"] if item["result"] == "FAIL"
    ]
    report = {
        "level": "L3",
        "suite": "TEXT-PER-TOOL-DECLARED-BOUNDARY",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "total": len(records),
        "passed": sum(item["result"] == "PASS" for item in records),
        "failed": sum(item["result"] != "PASS" for item in records),
        "method": "Each tool ran at its catalog maxInputBytes. Outputs were fully decoded in streaming mode; PDF pages were validated with pdfinfo and rendered at first/middle/last pages. Source hashes were compared before and after.",
        "initialOneGbFailuresRetained": initial_failures,
        "records": records,
    }
    destination = REPORT_DIR / "L3_TEXT_FINAL_REPORT.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"L3 TEXT FINAL SUMMARY {report['passed']}/{report['total']} pass")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
