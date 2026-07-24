import hashlib
import json
from pathlib import Path
import time
import uuid


SOURCE_ROOTS = ("backend", "electron", "frontend", "python_bridge", "python_pdf_helper", "scripts", "verify", "docs")
SOURCE_FILES = (
    "package.json", "package-lock.json", "go.mod", "go.sum",
    "python-bridge.spec", "build/installer.nsh", "THIRD_PARTY_NOTICES.md",
)
IGNORED_NAMES = {"__pycache__", "node_modules", ".git"}
_IDENTITY_CACHE = {}


def sha256_file(path):
    path = Path(path)
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_files(root):
    root = Path(root).resolve()
    files = []
    for name in SOURCE_ROOTS:
        directory = root / name
        if directory.exists():
            files.extend(path for path in directory.rglob("*") if path.is_file() and not any(part in IGNORED_NAMES for part in path.parts) and path.suffix != ".pyc")
    files.extend(root / name for name in SOURCE_FILES if (root / name).is_file())
    return sorted(set(files), key=lambda path: path.relative_to(root).as_posix())


def source_fingerprint(root):
    root = Path(root).resolve()
    digest = hashlib.sha256()
    files = source_files(root)
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest(), len(files)


def identity(root):
    root = Path(root).resolve()
    cache_key = str(root)
    if cache_key in _IDENTITY_CACHE:
        return dict(_IDENTITY_CACHE[cache_key])
    fingerprint, file_count = source_fingerprint(root)
    package = json.loads((root / "package.json").read_text("utf-8"))
    result = {
        "schemaVersion": 2,
        "runId": f"{int(time.time())}-{uuid.uuid4()}",
        "version": package["version"],
        "productVersion": package["version"],
        "sourceFingerprint": fingerprint,
        "sourceFileCount": file_count,
        "backendSha256": sha256_file(root / "bin" / "toolplus-backend.exe"),
        "engineSha256": sha256_file(root / "bin" / "toolplus-engine.exe"),
        "pythonBridgeSha256": sha256_file(root / "bin" / "python-bridge.exe"),
        "pdfPageNumbersHelperSha256": sha256_file(root / "bin" / "pdf-page-numbers-helper.exe"),
    }
    _IDENTITY_CACHE[cache_key] = result
    return dict(result)


def peak_rss(record):
    values = [int((record.get("execution") or {}).get("peakRssBytes") or 0)]
    values.extend(int((item.get("execution") or {}).get("peakRssBytes") or 0) for item in record.get("executions", []))
    values.extend(int((item.get("execution") or {}).get("peakRssBytes") or 0) for item in record.get("subcases", []))
    return max(values, default=0)


def finalize_record(record, tool, oracle_complete=False, root=None):
    if root is not None:
        run = identity(root)
        for name in (
            "runId", "version", "productVersion", "sourceFingerprint", "backendSha256", "engineSha256",
            "pythonBridgeSha256", "pdfPageNumbersHelperSha256",
        ):
            record[name] = run[name]
    record["oracleComplete"] = bool(oracle_complete)
    budget_mb = float((tool.get("performanceBudget") or {}).get("peakRssMB") or 0)
    peak = peak_rss(record)
    budget_bytes = int(budget_mb * 1024 * 1024) if budget_mb else None
    record["performanceGate"] = {"peakRssBytes": peak, "budgetBytes": budget_bytes, "passed": budget_bytes is None or peak <= budget_bytes}
    problems = []
    if not record["oracleComplete"]:
        problems.append("semantic oracle incomplete")
    if not record["performanceGate"]["passed"]:
        problems.append(f"peak RSS {peak} exceeds {budget_bytes}")
    if problems:
        record["result"] = "FAIL"
        record["gateProblems"] = problems
        record.setdefault("error", "; ".join(problems))
    return record


def resume_is_current(record, root):
    run = identity(root)
    return all(record.get(name) == run.get(name) for name in (
        "productVersion", "sourceFingerprint", "backendSha256", "engineSha256",
        "pythonBridgeSha256", "pdfPageNumbersHelperSha256",
    ))


def build_report(root, level, records, suite=None, **extra):
    report = {
        **identity(root),
        "level": level,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "total": len(records),
        "passed": sum(item.get("result") == "PASS" for item in records),
        "failed": sum(item.get("result") != "PASS" for item in records),
        "records": records,
        **extra,
    }
    if suite:
        report["suite"] = suite
    return report


def write_evidence(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        previous_payload = path.read_text("utf-8")
        try:
            previous = json.loads(previous_payload)
        except json.JSONDecodeError:
            previous = {}
        previous_run = previous.get("runId") or f"legacy-{int(path.stat().st_mtime)}-{hashlib.sha256(previous_payload.encode()).hexdigest()[:12]}"
        previous_archive = path.parent / "runs" / previous_run / path.name
        if not previous_archive.exists():
            previous_archive.parent.mkdir(parents=True, exist_ok=True)
            previous_archive.write_text(previous_payload, "utf-8")
    run_id = value.get("runId")
    if not run_id:
        raise ValueError("evidence is missing runId")
    archive = path.parent / "runs" / run_id / path.name
    archive.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    archive.write_text(payload, "utf-8")
    path.write_text(payload, "utf-8")
    return archive
