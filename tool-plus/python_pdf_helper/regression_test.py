from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import subprocess
import tempfile

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

import main as page_numbers


FORMAT = "第 %p 页 / 共 %P 页"


def make_shared_content_pdf(path: Path, pages: int = 9) -> None:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    for number in range(1, 4):
        pdf.drawString(72, 760, f"Shared source page {number}")
        pdf.showPage()
    pdf.save()
    buffer.seek(0)

    source = PdfReader(buffer)
    writer = PdfWriter()
    for index in range(pages):
        writer.add_page(source.pages[index % len(source.pages)])
    with path.open("wb") as stream:
        writer.write(stream)


def assert_numbered_pdf(path: Path, pages: int = 9) -> None:
    reader = PdfReader(path)
    assert len(reader.pages) == pages
    resource_counts = []
    for page_number, page in enumerate(reader.pages, start=1):
        resources = page["/Resources"].get_object()
        counts = {}
        for resource_name in ("/Font", "/XObject", "/ExtGState"):
            resource = resources.get(resource_name)
            counts[resource_name] = len(resource.get_object()) if resource is not None else 0
        resource_counts.append(counts)
        assert counts["/Font"] <= 4, (page_number, counts)
        assert counts["/XObject"] <= 2, (page_number, counts)
        assert counts["/ExtGState"] <= 2, (page_number, counts)
    for page_number in (1, pages // 2 + 1, pages):
        text = reader.pages[page_number - 1].extract_text() or ""
        assert f"第 {page_number} 页 / 共 {pages} 页" in text, (page_number, text)
        source_page = (page_number - 1) % 3 + 1
        assert f"Shared source page {source_page}" in text, (page_number, text)
    assert resource_counts[-1] == resource_counts[0], resource_counts


def run_direct(source: Path, output: Path) -> None:
    page_numbers.number_pdf(
        source,
        output,
        {"format": FORMAT, "position": "底部居中", "fontSize": "10", "start": "1"},
    )


def run_executable(helper: Path, source: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    sentinel = output_dir / f"{source.stem}_numbered.pdf"
    sentinel.write_bytes(b"do not overwrite")
    request = {
        "tool": "pdf-page-numbers",
        "inputs": [str(source)],
        "outputDir": str(output_dir),
        "options": {"format": FORMAT, "position": "底部居中", "fontSize": "10", "start": "1"},
    }
    completed = subprocess.run(
        [str(helper)],
        input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    response = json.loads(completed.stdout.decode("utf-8"))
    assert completed.returncode == 0 and response.get("ok") is True, (
        completed.returncode,
        response,
        completed.stderr.decode("utf-8", errors="replace"),
    )
    output = Path(response["outputs"][0])
    assert output.name == f"{source.stem}_numbered_2.pdf", output
    assert sentinel.read_bytes() == b"do not overwrite"
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--helper", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="toolplus-pdf-page-numbers-") as temporary:
        root = Path(temporary)
        source = root / "shared-content.pdf"
        make_shared_content_pdf(source)
        if args.helper:
            output = run_executable(args.helper.resolve(), source, root / "executable-output")
            mode = "executable"
        else:
            reserved: set[Path] = set()
            existing = root / f"{source.stem}_numbered.pdf"
            existing.write_bytes(b"do not overwrite")
            selected = page_numbers.unique_output_path(root, source, reserved)
            assert selected.name == f"{source.stem}_numbered_2.pdf"
            assert existing.read_bytes() == b"do not overwrite"
            output = root / "direct-output.pdf"
            run_direct(source, output)
            mode = "direct"
        assert_numbered_pdf(output)
    print(f"PDF page-number shared-content regression ({mode}): PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
