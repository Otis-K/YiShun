from __future__ import annotations

import json
import os
import sys
from pathlib import Path


tool_root = os.environ.get("TOOLPLUS_TOOL_ROOT")
if tool_root:
    resolved_tool_root = str(Path(tool_root).resolve())
    if resolved_tool_root not in sys.path:
        sys.path.insert(0, resolved_tool_root)

from batchtool.runner import run_tool  # noqa: E402
from batchtool.tool_catalog import TOOL_MAP  # noqa: E402


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        tool_key = payload["tool"]
        tool = TOOL_MAP[tool_key]
        options = normalize_options(tool_key, payload.get("options", {}))
        result = run_tool(
            tool,
            payload.get("inputs", []),
            payload.get("outputDir"),
            options,
        )
        print(json.dumps({"ok": True, "outputs": [str(p) for p in result]}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


def normalize_options(tool_key: str, options: dict) -> dict:
    converted = dict(options or {})
    if tool_key == "pdf-add-margin" and "margin" in converted:
        converted["margin"] = float(converted["margin"])
    return converted


if __name__ == "__main__":
    raise SystemExit(main())
