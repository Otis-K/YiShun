import argparse
import http.server
import json
import os
from pathlib import Path
import shutil
import statistics
import threading
import time

import matrix_runner as matrix
import report_identity


def percentile(values, fraction):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))]


def clone_inputs(inputs, destination, iteration):
    cloned = []
    for index, value in enumerate(inputs):
        source = Path(value)
        target_root = destination / f"task-{iteration:03d}"
        target_root.mkdir(parents=True, exist_ok=True)
        target = target_root / f"{index:02d}-{source.name}"
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            shutil.copy2(source, target)
        cloned.append(str(target))
    return cloned


def execute_level(level, repeats, selected):
    output_root = matrix.OUTPUT_ROOT / level
    sample_root = matrix.ACCEPTANCE / "samples" / level
    log_root = matrix.LOG_ROOT / level
    for folder in (output_root, sample_root, log_root):
        folder.mkdir(parents=True, exist_ok=True)
    os.chdir(matrix.SAMPLES)
    server = matrix.ReusableServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    web_url = f"http://127.0.0.1:{server.server_address[1]}/real-video.mp4"
    completed = {}
    report_records = []
    try:
        for tool_index, tool in enumerate(matrix.CATALOG, 1):
            key = tool["key"]
            if selected and key not in selected:
                continue
            base_inputs = matrix.inputs_for(tool, completed)
            tool_samples = sample_root / key
            tool_output = output_root / key
            for folder in (tool_samples, tool_output):
                if folder.exists():
                    shutil.rmtree(folder)
                folder.mkdir(parents=True)
            executions = []
            all_outputs = []
            error = ""
            for iteration in range(1, repeats + 1):
                inputs = clone_inputs(base_inputs, tool_samples, iteration)
                input_before = {value: matrix.sha256(value) for value in inputs if Path(value).is_file()}
                out_dir = tool_output / f"task-{iteration:03d}"
                out_dir.mkdir(parents=True)
                request = {
                    "tool": key,
                    "inputs": inputs,
                    "outputDir": str(out_dir),
                    "options": matrix.default_options(tool, web_url),
                }
                execution = matrix.run_request(request, min(int(tool.get("timeoutSeconds", 300)), 600))
                item = {
                    "iteration": iteration,
                    "request": request,
                    "inputHashesBefore": input_before,
                    "execution": {name: value for name, value in execution.items() if name not in {"stdout", "stderr"}},
                    "stderr": execution["stderr"][-1000:],
                    "result": "FAIL",
                    "outputs": [],
                    "oracles": [],
                }
                try:
                    response = json.loads(execution["stdout"] or "{}")
                    if execution["timedOut"]:
                        raise AssertionError("任务超时")
                    if not response.get("ok"):
                        raise AssertionError(matrix.response_error(response, execution))
                    outputs = response.get("outputs") or []
                    if not outputs:
                        raise AssertionError("成功但未返回输出")
                    input_after = {value: matrix.sha256(value) for value in inputs if Path(value).is_file()}
                    if input_before != input_after:
                        raise AssertionError("原文件哈希变化")
                    for output in outputs:
                        item["oracles"].append({"path": output, **matrix.validate_file(output)})
                    files = matrix.flatten_outputs(outputs)
                    item["outputs"] = [{"path": str(path), "bytes": path.stat().st_size, "sha256": matrix.sha256(path)} for path in files]
                    item["inputHashesAfter"] = input_after
                    item["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
                    item["oracleComplete"] = True
                    item["result"] = "PASS"
                    all_outputs.extend(outputs)
                    completed[key] = outputs
                except Exception as exception:
                    item["error"] = str(exception)
                    item["oracleComplete"] = False
                    error = f"iteration {iteration}: {exception}"
                executions.append(item)
                if error:
                    break
            durations = [item["execution"]["durationMs"] for item in executions]
            record = {
                "caseId": f"{key}:{level}-real-load",
                "level": level,
                "tool": key,
                "category": tool["category"],
                "plannedTasks": repeats,
                "completedTasks": len(executions),
                "passedTasks": sum(item["result"] == "PASS" for item in executions),
                "result": "PASS" if len(executions) == repeats and not error else "FAIL",
                "error": error,
                "metrics": {
                    "durationTotalMs": sum(durations),
                    "durationP50Ms": percentile(durations, 0.50),
                    "durationP95Ms": percentile(durations, 0.95),
                    "durationWorstMs": max(durations, default=0),
                    "peakRssBytes": max((item["execution"]["peakRssBytes"] for item in executions), default=0),
                    "outputCount": len(matrix.flatten_outputs(all_outputs)),
                },
                "executions": executions,
            }
            oracle_complete = len(executions) == repeats and all(item.get("oracleComplete") is True for item in executions)
            report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
            report_identity.write_evidence(log_root / f"{key}.json", record)
            report_records.append(record)
            print(f"{record['result']} {level} {tool_index:03d}/114 {key} tasks={record['passedTasks']}/{repeats}{' ' + error if error else ''}", flush=True)
    finally:
        server.shutdown()
        server.server_close()
    report = report_identity.build_report(matrix.ROOT, level, report_records, suite="repeated-real-load", tasksPerTool=repeats)
    report_identity.write_evidence(matrix.ACCEPTANCE / f"{level}_REPORT.json", report)
    print(f"{level} SUMMARY {report['passed']}/{report['total']} pass, {report['failed']} fail")
    return 0 if report["failed"] == 0 else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", choices=["L1"], default="L1")
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--tool", action="append")
    args = parser.parse_args()
    return execute_level(args.level, args.repeats, set(args.tool or []))


if __name__ == "__main__":
    raise SystemExit(main())
