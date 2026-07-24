import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import matrix_runner as matrix
import report_identity


LEVEL = "L3"
COUNT = 100_000
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL / "file-100k"
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / "file-100k"
LOG_ROOT = matrix.LOG_ROOT / LEVEL / "file-100k"


def make_samples():
    files_root = SAMPLE_ROOT / "files"
    folders_root = SAMPLE_ROOT / "folders"
    seeds_root = SAMPLE_ROOT / "seeds-v2"
    marker = SAMPLE_ROOT / ".hardlink-groups-v2"
    SAMPLE_ROOT.mkdir(parents=True, exist_ok=True)
    if not marker.exists() or not files_root.exists() or sum(1 for _ in files_root.iterdir()) != COUNT:
        if files_root.exists():
            shutil.rmtree(files_root)
        if seeds_root.exists():
            shutil.rmtree(seeds_root)
        files_root.mkdir()
        seeds_root.mkdir()
        seeds = []
        for group in range(100):
            seed = seeds_root / f"seed-{group:03d}.txt"
            seed.write_text("ToolPlus L3 100k\n", encoding="utf-8")
            seeds.append(seed)
        for index in range(COUNT):
            target = files_root / f"item-{index:06d}.txt"
            os.link(seeds[index // 1000], target)
            if index and index % 10_000 == 0:
                print(f"GENERATE files {index}/{COUNT}", flush=True)
        marker.write_text("100 groups x 1000 links", encoding="utf-8")
    if not folders_root.exists() or sum(1 for _ in folders_root.iterdir()) != COUNT:
        if folders_root.exists():
            shutil.rmtree(folders_root)
        folders_root.mkdir()
        for index in range(COUNT):
            (folders_root / f"Demo Folder {index:06d}").mkdir()
            if index and index % 10_000 == 0:
                print(f"GENERATE folders {index}/{COUNT}", flush=True)
    return files_root, folders_root


def tree_manifest(root, hash_files, shared_hardlink=False):
    digest = hashlib.sha256()
    files = directories = total_bytes = 0
    inode_hashes = {}
    for item in sorted(root.rglob("*"), key=lambda value: str(value.relative_to(root))):
        relative = str(item.relative_to(root)).replace("\\", "/")
        if item.is_dir():
            directories += 1
            digest.update(f"D:{relative}\n".encode())
        elif item.is_file():
            files += 1
            stat = item.stat()
            size = stat.st_size
            total_bytes += size
            digest.update(f"F:{relative}:{size}:".encode())
            if hash_files:
                if shared_hardlink:
                    if stat.st_ino not in inode_hashes:
                        inode_hashes[stat.st_ino] = matrix.sha256(item)
                    digest.update(inode_hashes[stat.st_ino].encode())
                else:
                    digest.update(matrix.sha256(item).encode())
            digest.update(b"\n")
    return {
        "files": files, "directories": directories, "bytes": total_bytes,
        "sha256": digest.hexdigest(), "allFilesHashed": hash_files,
        "hashStrategy": "grouped-hardlink-objects+all-paths" if shared_hardlink else ("each-file" if hash_files else "paths-only"),
        "uniqueContentObjects": len(inode_hashes) if shared_hardlink else None
    }


def content_samples(root, allowed_hashes, count=100):
    files = sorted((path for path in root.rglob("*") if path.is_file()), key=lambda value: str(value.relative_to(root)))
    if not files:
        return []
    indexes = sorted({round(index * (len(files) - 1) / max(1, count - 1)) for index in range(min(count, len(files)))})
    samples = []
    for index in indexes:
        path = files[index]
        digest = matrix.sha256(path)
        if allowed_hashes and digest not in allowed_hashes:
            raise AssertionError(f"输出内容哈希不属于源内容集合: {path}")
        samples.append({
            "index": index,
            "relativePath": str(path.relative_to(root)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": digest,
        })
    return samples


def main():
    for folder in (SAMPLE_ROOT, OUTPUT_ROOT, LOG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    files_root, folders_root = make_samples()
    file_inputs = [str(path) for path in sorted(files_root.iterdir())]
    folder_inputs = [str(path) for path in sorted(folders_root.iterdir())]
    source_file_manifest = tree_manifest(files_root, True, True)
    source_folder_manifest = tree_manifest(folders_root, False)
    source_content_hashes = {
        matrix.sha256(files_root / f"item-{group * 1000:06d}.txt")
        for group in range(100)
    }
    tools = [tool for tool in matrix.CATALOG if tool["category"] in {"文件命名", "文件夹命名", "文件整理"}]
    records = []
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        log_path = LOG_ROOT / f"{key}.json"
        if os.environ.get("L3_FILE_RESUME") == "1" and log_path.exists():
            prior = json.loads(log_path.read_text(encoding="utf-8"))
            if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                records.append(prior)
                print(f"SKIP L3-FILE {index:02d}/{len(tools)} {key} ({prior['result']})", flush=True)
                continue
        output_dir = OUTPUT_ROOT / key
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        if key == "mirror-folders":
            inputs = [str(folders_root)]
            source_before = source_folder_manifest
        elif tool["inputKind"] == "folders":
            inputs = folder_inputs
            source_before = source_folder_manifest
        else:
            inputs = file_inputs
            source_before = source_file_manifest
        request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": matrix.default_options(tool, "")}
        execution = matrix.run_request(request, max(1800, int(tool.get("timeoutSeconds", 900))))
        record = {
            "caseId": f"{key}:L3-limit", "level": LEVEL, "tool": key,
            "scale": {"inputPaths": len(inputs), "sourceFiles": source_before["files"], "sourceDirectories": source_before["directories"]},
            "execution": {k: v for k, v in execution.items() if k not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:], "sourceManifestBefore": source_before,
            "result": "FAIL"
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("10 万项任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("成功响应没有输出")
            output_manifest = tree_manifest(output_dir, False)
            if output_manifest["files"] == 0 and output_manifest["directories"] == 0:
                raise AssertionError("输出树为空")
            source_after = tree_manifest(files_root, True, True) if source_before["files"] else tree_manifest(folders_root, False)
            if source_before != source_after:
                raise AssertionError("源输入树发生变化")
            record["sourceManifestAfter"] = source_after
            record["outputManifest"] = output_manifest
            record["outputContentSamples"] = content_samples(output_dir, source_content_hashes, 100)
            record["contentSampling"] = {
                "strategy": "uniform-across-sorted-output-paths",
                "sampleCount": len(record["outputContentSamples"]),
                "allowedSourceContentHashes": sorted(source_content_hashes),
                "fullPathAndSizeManifest": True,
            }
            record["responseOutputCount"] = len(outputs)
            record["outputSamples"] = outputs[:3] + outputs[-3:]
            record["semanticOracle"] = matrix.semantic_oracles.validate(tool, request, outputs, matrix.ROOT)
            oracle_complete = True
            record["result"] = "PASS"
        except Exception as error:
            record["error"] = str(error)
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        records.append(record)
        report_identity.write_evidence(log_path, record)
        print(f"{record['result']} L3-FILE {index:02d}/{len(tools)} {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
        shutil.rmtree(output_dir, ignore_errors=True)
    passed = sum(item["result"] == "PASS" for item in records)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="FILE-100000-items")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_FILE_REPORT.json", report)
    print(f"L3 FILE SUMMARY {passed}/{len(records)} pass", flush=True)
    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
