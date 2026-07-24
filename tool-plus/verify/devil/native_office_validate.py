#!/usr/bin/env python3
"""Run the native Office round-trip validator with a hard timeout.

The PowerShell COM automation is intentionally isolated in a child process. On
timeout, only that child process tree and Office processes created after the
validator started are terminated. Existing user Office sessions are preserved.
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


OFFICE_IMAGES = {"WINWORD.EXE", "EXCEL.EXE", "POWERPNT.EXE"}


TH32CS_SNAPPROCESS = 0x00000002
PROCESS_TERMINATE = 0x0001
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def office_processes() -> dict[int, str]:
    found: dict[int, str] = {}
    snapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        return found
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    try:
        success = ctypes.windll.kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while success:
            image = entry.szExeFile
            if image.upper() in OFFICE_IMAGES:
                found[int(entry.th32ProcessID)] = image
            success = ctypes.windll.kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        ctypes.windll.kernel32.CloseHandle(snapshot)
    return found


def terminate_pid(pid: int) -> bool:
    handle = ctypes.windll.kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
    if not handle:
        return False
    try:
        return bool(ctypes.windll.kernel32.TerminateProcess(handle, 1))
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def kill_new_office(before: dict[int, str]) -> list[dict[str, object]]:
    killed = []
    for pid, image in office_processes().items():
        if pid in before:
            continue
        killed.append({"pid": pid, "image": image, "terminated": terminate_pid(pid)})
    return killed


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    path = args.path.resolve()
    script = Path(__file__).with_name("native_office_validate.ps1")
    reopen_script = Path(__file__).with_name("native_office_reopen.ps1")
    before = office_processes()
    started = time.monotonic()
    progress_file = Path(tempfile.gettempdir()) / f"toolplus-office-stage-{time.time_ns()}.txt"
    process = subprocess.Popen(
        [
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-Path",
            str(path),
            "-ProgressPath",
            str(progress_file),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.kill()
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            stdout, stderr = "", "validator process did not exit after forced termination"

    payload: dict[str, object] = {
        "path": str(path),
        "timeoutSeconds": args.timeout,
        "timedOut": timed_out,
        "exitCode": process.returncode,
        "stderr": stderr.strip(),
        "lastStage": progress_file.read_text(encoding="utf-8") if progress_file.exists() else "not-started",
    }
    progress_file.unlink(missing_ok=True)
    if stdout.strip():
        try:
            payload["native"] = json.loads(stdout.strip().splitlines()[-1])
        except json.JSONDecodeError:
            payload["stdout"] = stdout.strip()

    native = payload.get("native")
    if not timed_out and process.returncode == 0 and isinstance(native, dict) and native.get("copyPath"):
        copy_path = Path(native["copyPath"])
        payload["phaseOneOfficeCleanup"] = kill_new_office(before)
        time.sleep(5)
        try:
            with zipfile.ZipFile(copy_path) as archive:
                payload["savedCopyZipBadMember"] = archive.testzip()
        except (OSError, zipfile.BadZipFile) as error:
            payload["savedCopyZipError"] = str(error)
        reopen_path = copy_path.with_name(f"{copy_path.stem}-reopen{copy_path.suffix}")
        shutil.copy2(copy_path, reopen_path)
        payload["savedCopySha256"] = sha256(copy_path)
        payload["reopenCopySha256"] = sha256(reopen_path)
        payload["reopenCopyByteIdentical"] = payload["savedCopySha256"] == payload["reopenCopySha256"]
        reopen = subprocess.Popen(
            [
                "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive",
                "-ExecutionPolicy", "Bypass", "-File", str(reopen_script), "-Path", str(reopen_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        reopen_timed_out = False
        try:
            reopen_stdout, reopen_stderr = reopen.communicate(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            reopen_timed_out = True
            reopen.kill()
            reopen_stdout, reopen_stderr = reopen.communicate()
        payload["reopenExitCode"] = reopen.returncode
        payload["reopenTimedOut"] = reopen_timed_out
        payload["reopenStderr"] = reopen_stderr.strip()
        if reopen_stdout.strip():
            try:
                payload["nativeReopen"] = json.loads(reopen_stdout.strip().splitlines()[-1])
            except json.JSONDecodeError:
                payload["reopenStdout"] = reopen_stdout.strip()
        native["reopenedCopy"] = (
            not reopen_timed_out
            and reopen.returncode == 0
            and isinstance(payload.get("nativeReopen"), dict)
            and payload["nativeReopen"].get("opened") is True
        )
        if native["reopenedCopy"]:
            copy_path.unlink(missing_ok=True)
            reopen_path.unlink(missing_ok=True)
        timed_out = timed_out or reopen_timed_out
        payload["timedOut"] = timed_out

    killed = kill_new_office(before)
    payload["killedNewOfficeProcesses"] = killed
    payload["elapsedSeconds"] = round(time.monotonic() - started, 3)

    passed = (
        not timed_out
        and process.returncode == 0
        and isinstance(native, dict)
        and all(native.get(key) is True for key in ("opened", "savedCopy", "reopenedCopy"))
    )
    payload["passed"] = passed
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
