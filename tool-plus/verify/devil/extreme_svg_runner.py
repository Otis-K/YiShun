import json
import os
from pathlib import Path
import shutil

import matrix_runner as matrix
import report_identity


LEVEL = "L3"
TOOLS = ("svg-to-pdf", "svg-to-jpg")


def source_digest(paths):
    import hashlib
    digest = hashlib.sha256()
    for path in paths:
        digest.update(Path(path).name.encode("utf-8"))
        digest.update(matrix.sha256(path).encode("ascii"))
    return digest.hexdigest()


def main():
    sample_root = matrix.ACCEPTANCE / "samples" / LEVEL / "svg-boundary"
    output_root = matrix.OUTPUT_ROOT / LEVEL / "svg-boundary"
    log_root = matrix.LOG_ROOT / LEVEL / "svg-boundary"
    for folder in (sample_root, output_root, log_root):
        folder.mkdir(parents=True, exist_ok=True)
    source = Path(matrix.sample("shape.svg"))
    records = []
    catalog = {tool["key"]: tool for tool in matrix.CATALOG}
    for tool_index, key in enumerate(TOOLS, 1):
        tool = catalog[key]
        count = int(tool["limits"]["maxInputs"])
        tool_samples = sample_root / key
        if tool_samples.exists():
            shutil.rmtree(tool_samples)
        tool_samples.mkdir(parents=True)
        inputs = []
        for index in range(count):
            target = tool_samples / f"shape-{index:03d}.svg"
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
            inputs.append(str(target))
        before = source_digest(inputs)
        output_dir = output_root / key
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": matrix.default_options(tool, "")}
        execution = matrix.run_request(request, int(tool.get("timeoutSeconds", 900)))
        record = {
            "caseId": f"{key}:L3-limit",
            "level": LEVEL,
            "tool": key,
            "category": tool["category"],
            "declaredMaxInputs": count,
            "inputDigestBefore": before,
            "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:],
            "result": "FAIL",
            "oracles": [],
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("SVG 声明边界任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if len(outputs) != count:
                raise AssertionError(f"SVG 输出数量 {len(outputs)} != 输入数量 {count}")
            for output in outputs:
                record["oracles"].append({"path": output, **matrix.validate_file(output)})
            after = source_digest(inputs)
            if before != after:
                raise AssertionError("SVG 源输入聚合哈希发生变化")
            record["inputDigestAfter"] = after
            record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
            record["outputCount"] = len(outputs)
            record["result"] = "PASS"
            oracle_complete = True
        except Exception as error:
            record["error"] = str(error)
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        report_identity.write_evidence(log_root / f"{key}.json", record)
        records.append(record)
        print(f"{record['result']} L3-SVG {tool_index}/2 {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="SVG-DECLARED-MAX-INPUTS")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_SVG_REPORT.json", report)
    print(f"L3 SVG SUMMARY {report['passed']}/{report['total']} pass")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
