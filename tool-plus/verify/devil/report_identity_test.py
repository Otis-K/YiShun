import json
from pathlib import Path
import subprocess

import report_identity


ROOT = Path(__file__).resolve().parents[2]


def main():
    node = subprocess.run(
        ["node", "-e", "const x=require('./verify/devil/acceptance-lib').sourceFingerprint(process.cwd()); process.stdout.write(JSON.stringify(x))"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    expected = json.loads(node.stdout)
    fingerprint, count = report_identity.source_fingerprint(ROOT)
    assert fingerprint == expected["fingerprint"]
    assert count == expected["fileCount"]

    tool = {"performanceBudget": {"peakRssMB": 100}}
    over_budget = {"result": "PASS", "execution": {"peakRssBytes": 101 * 1024 * 1024}}
    report_identity.finalize_record(over_budget, tool, oracle_complete=True, root=ROOT)
    assert over_budget["result"] == "FAIL"
    assert over_budget["performanceGate"]["passed"] is False

    missing_oracle = {"result": "PASS", "execution": {"peakRssBytes": 1}}
    report_identity.finalize_record(missing_oracle, tool, oracle_complete=False, root=ROOT)
    assert missing_oracle["result"] == "FAIL"
    assert "semantic oracle incomplete" in missing_oracle["gateProblems"]
    assert report_identity.resume_is_current(missing_oracle, ROOT)

    stale = dict(missing_oracle, sourceFingerprint="stale")
    assert report_identity.resume_is_current(stale, ROOT) is False
    stale_helper = dict(missing_oracle, pdfPageNumbersHelperSha256="stale")
    assert report_identity.resume_is_current(stale_helper, ROOT) is False
    print(f"PASS report-identity fingerprint={fingerprint} files={count} budget-and-oracle-hard-gates")


if __name__ == "__main__":
    main()
