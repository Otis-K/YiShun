import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import re

from PIL import Image, ImageChops
from pypdf import PdfReader

try:
    import pypdfium2 as pdfium
except ImportError:
    pdfium = None

import large_runner
import matrix_runner as matrix
import report_identity


LEVEL = "L3"
SAMPLE_ROOT = matrix.ACCEPTANCE / "samples" / LEVEL
OUTPUT_ROOT = matrix.OUTPUT_ROOT / LEVEL / "pdf-5000"
LOG_ROOT = matrix.LOG_ROOT / LEVEL / "pdf-5000"
PDFINFO = Path(sys.executable).resolve().parents[1] / "native" / "poppler" / "Library" / "bin" / "pdfinfo.exe"
PDFTOPPM = PDFINFO.with_name("pdftoppm.exe")
PDFCPU = matrix.ROOT / "tools" / "pdfcpu.exe"


def reset(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def pdf_info(path):
    info = subprocess.run([str(PDFINFO), "-upw", "secret", str(path)], capture_output=True, timeout=60)
    info_text = info.stdout.decode(errors="replace")
    if info.returncode != 0:
        raise AssertionError("pdfinfo 校验失败: " + info.stderr.decode(errors="replace"))
    values = {}
    for line in info_text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
    pages = int(values.get("Pages", "0"))
    if pages < 1:
        raise AssertionError(f"pdfinfo 未返回有效页数: {path}")
    return values


def validate_pdf(path, deep_check=True):
    if deep_check:
        values = pdf_info(path)
        pages = int(values["Pages"])
        encrypted = values.get("Encrypted", "no").lower().startswith("yes")
        entry = {"type": "pdf", "encrypted": encrypted, "pages": pages, "validators": ["poppler-pdfinfo"]}
        render_root = matrix.ACCEPTANCE / "validator-temp" / Path(path).stem
        reset(render_root)
        rendered_pages = sorted({1, max(1, pages // 2), pages})
        for page_number in rendered_pages:
            prefix = render_root / f"page-{page_number}"
            command = [str(PDFTOPPM), "-f", str(page_number), "-l", str(page_number), "-singlefile", "-scale-to", "256", "-png"]
            if encrypted:
                command.extend(["-upw", "secret"])
            command.extend([str(path), str(prefix)])
            rendered = subprocess.run(command, capture_output=True, timeout=120)
            image_path = prefix.with_suffix(".png")
            if rendered.returncode != 0 or not image_path.exists():
                raise AssertionError("Poppler 页面渲染失败: " + rendered.stderr.decode(errors="replace"))
            with Image.open(image_path) as image:
                image.verify()
        shutil.rmtree(render_root)
        entry["validators"].append("poppler-render-pages")
        entry["renderedPages"] = rendered_pages
    else:
        reader = PdfReader(path)
        if reader.is_encrypted or len(reader.pages) < 1:
            raise AssertionError(f"拆分页不可解析: {path}")
        entry = {"type": "pdf", "encrypted": False, "pages": len(reader.pages), "validators": ["pypdf"], "popplerRender": "sampled-separately"}
    return entry


def page_text(path, page_number):
    trim_root = matrix.ACCEPTANCE / "validator-temp" / "pdfcpu-page-samples"
    trim_root.mkdir(parents=True, exist_ok=True)
    target = trim_root / f"{Path(path).stem}-page-{page_number}-{os.getpid()}-{time.time_ns()}.pdf"
    command = [
        str(PDFCPU), "trim", "--quiet", "--conf", "disable", "--upw", "secret",
        "--pages", str(page_number), str(path), str(target),
    ]
    completed = subprocess.run(command, capture_output=True, timeout=180)
    try:
        if completed.returncode != 0 or not target.exists():
            raise AssertionError("pdfcpu 单页抽取失败: " + completed.stderr.decode(errors="replace"))
        reader = PdfReader(target)
        if reader.is_encrypted:
            assert reader.decrypt("secret") != 0
        assert len(reader.pages) == 1
        return reader.pages[0].extract_text() or ""
    finally:
        target.unlink(missing_ok=True)


def normalized_text(value):
    return re.sub(r"\s+", "", value or "")


def page_visual_evidence(source, output, page_numbers, require_footer=False):
    render_root = matrix.ACCEPTANCE / "validator-temp" / "page-number-visual"
    reset(render_root)
    evidence = []
    try:
        for page_number in page_numbers:
            images = []
            for label, path in (("source", source), ("output", output)):
                if pdfium is not None:
                    document = pdfium.PdfDocument(str(path))
                    page = document[page_number - 1]
                    width, height = page.get_size()
                    scale = 768 / max(width, height)
                    bitmap = page.render(scale=scale)
                    images.append(bitmap.to_pil().convert("RGB").copy())
                    bitmap.close()
                    page.close()
                    document.close()
                else:
                    prefix = render_root / f"{label}-{page_number}"
                    command = [
                        str(PDFTOPPM), "-f", str(page_number), "-l", str(page_number),
                        "-singlefile", "-scale-to", "768", "-png", str(path), str(prefix),
                    ]
                    completed = subprocess.run(command, capture_output=True, timeout=180)
                    rendered = prefix.with_suffix(".png")
                    if completed.returncode != 0 or not rendered.exists():
                        raise AssertionError("页码视觉抽样渲染失败: " + completed.stderr.decode(errors="replace"))
                    with Image.open(rendered) as image:
                        images.append(image.convert("RGB").copy())
            assert images[0].size == images[1].size
            difference = ImageChops.difference(images[0], images[1])
            box = difference.getbbox()
            assert box is not None, f"第 {page_number} 页渲染未发现页码变化"
            if require_footer:
                assert box[1] >= int(images[0].height * 0.65), f"第 {page_number} 页变化不在页脚区域: {box}"
            evidence.append({
                "page": page_number,
                "differenceBox": list(box),
                "imageSize": list(images[0].size),
                "footerOnly": bool(require_footer),
                "renderer": "pdfium" if pdfium is not None else "poppler",
            })
        return evidence
    finally:
        shutil.rmtree(render_root, ignore_errors=True)


def selected_page_count(specification, total):
    pages = []
    for part in (specification or "all").split(","):
        part = part.strip()
        if part == "all":
            return total
        if "-" in part:
            start, end = map(int, part.split("-", 1))
            pages.extend(range(start, end + 1))
        elif part:
            pages.append(int(part))
    return len(pages)


def validate_boundary_semantics(key, request, outputs, oracles):
    options = request.get("options") or {}
    inputs = [Path(value) for value in request.get("inputs") or []]
    output_paths = [Path(value) for value in outputs]
    pdf_oracles = [item for item in oracles if item.get("type") == "pdf"]
    first_pdf = output_paths[0] if output_paths and output_paths[0].suffix.lower() == ".pdf" else None
    pages = int(pdf_oracles[0]["pages"]) if pdf_oracles else 0
    source_pages = int(pdf_info(inputs[0])["Pages"]) if inputs and inputs[0].suffix.lower() == ".pdf" else 0
    evidence = {"oracle": "poppler-boundary-semantic", "tool": key, "sourcePages": source_pages, "outputCount": len(outputs)}

    if key == "pdf-to-txt":
        text = output_paths[0].read_text(encoding="utf-8", errors="replace")
        assert output_paths[0].stat().st_size > 0 and "hello pdf page" in text.lower()
        assert len([line for line in text.splitlines() if line.strip()]) == source_pages
        evidence["nonEmptyLines"] = source_pages
    elif key in {"pdf-to-jpg", "pdf-extract-images"}:
        assert output_paths and all(item.get("decoded") is True for item in oracles)
        evidence["decodedImages"] = len(output_paths)
    elif key == "pdf-encrypt":
        assert pdf_oracles[0]["encrypted"] is True and pages == source_pages
    elif key == "pdf-decrypt":
        assert pdf_oracles[0]["encrypted"] is False and pages == source_pages
    elif key == "pdf-merge":
        expected = sum(int(pdf_info(path)["Pages"]) for path in inputs)
        assert pages == expected
        evidence["expectedPages"] = expected
    elif key == "pdf-delete-pages":
        assert pages == source_pages - selected_page_count(options.get("pages"), source_pages)
    elif key in {"pdf-reorder", "pdf-extract-pages"}:
        specification = options.get("pages")
        assert pages == selected_page_count(specification, source_pages)
        requested = []
        for part in specification.split(","):
            if "-" in part:
                start, end = map(int, part.split("-", 1)); requested.extend(range(start, end + 1))
            else:
                requested.append(int(part))
        for output_page, source_page in enumerate(requested, 1):
            assert normalized_text(page_text(first_pdf, output_page)) == normalized_text(page_text(inputs[0], source_page))
    elif key == "pdf-split":
        assert len(outputs) == source_pages
        assert all(int(item.get("pages", 0)) == 1 for item in pdf_oracles)
    elif key == "pdf-odd-even":
        assert pages == source_pages
        odd_count = (source_pages + 1) // 2
        mappings = []
        for output_page in sorted({1, odd_count, odd_count + 1, pages}):
            source_page = 2 * output_page - 1 if output_page <= odd_count else 2 * (output_page - odd_count)
            assert normalized_text(page_text(first_pdf, output_page)) == normalized_text(page_text(inputs[0], source_page))
            mappings.append({"outputPage": output_page, "sourcePage": source_page})
        evidence["sampledMappings"] = mappings
    elif key == "pdf-page-numbers":
        assert pages == source_pages and matrix.sha256(first_pdf) != matrix.sha256(inputs[0])
        sampled = sorted({1, max(1, pages // 2), pages})
        evidence["visualFooterDifferences"] = page_visual_evidence(inputs[0], first_pdf, sampled, require_footer=True)
        evidence["sampledPages"] = sampled
        evidence["declaredFormat"] = options.get("format")
        template = options.get("format") or "第 %p 页 / 共 %P 页"
        start = int(options.get("start") or 1)
        exact_texts = []
        for page_number in sampled:
            expected = template.replace("%P", str(pages)).replace("%p", str(start + page_number - 1))
            actual = page_text(first_pdf, page_number)
            assert normalized_text(expected) in normalized_text(actual), (
                f"第 {page_number} 页缺少精确页码文本 {expected!r}: {actual!r}"
            )
            exact_texts.append({"page": page_number, "expected": expected})
        evidence["exactPageNumberTexts"] = exact_texts
    elif key in {"pdf-watermark", "pdf-stamp"}:
        assert pages == source_pages
        assert matrix.sha256(first_pdf) != matrix.sha256(inputs[0])
        sampled = [1, pages]
        evidence["visualPageDifferences"] = page_visual_evidence(inputs[0], first_pdf, sampled)
        evidence["sampledPages"] = sampled
        evidence["declaredText"] = options.get("text")
    elif key == "pdf-metadata":
        values = pdf_info(first_pdf)
        assert options.get("title") in values.get("Title", "")
    elif key in {"pdf-redact", "pdf-modify", "pdf-rotate", "pdf-add-margin", "pdf-compress"}:
        assert pages == source_pages and matrix.sha256(first_pdf) != matrix.sha256(inputs[0])
    else:
        raise AssertionError(f"L3 PDF 语义判定器未实现: {key}")
    evidence["pages"] = pages
    return evidence


def validate_outputs(outputs):
    oracles = []
    pdf_outputs = [Path(value) for value in outputs if Path(value).suffix.lower() == ".pdf"]
    sampled_pdfcpu = set()
    if pdf_outputs:
        sampled_pdfcpu = {0, len(pdf_outputs) // 2, len(pdf_outputs) - 1}
    for index, value in enumerate(outputs):
        path = Path(value)
        if not path.exists():
            raise AssertionError(f"输出不存在: {path}")
        if path.is_dir():
            oracles.append({"path": value, **matrix.validate_file(value)})
        elif path.suffix.lower() == ".pdf":
            entry = validate_pdf(path, index in sampled_pdfcpu or len(pdf_outputs) <= 20)
            oracles.append({"path": value, **entry})
        elif path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
            with Image.open(path) as image:
                image.verify()
            oracles.append({"path": value, "type": "image", "decoded": True})
        else:
            oracles.append({"path": value, **matrix.validate_file(value)})
    return oracles


def main():
    for folder in (SAMPLE_ROOT, OUTPUT_ROOT, LOG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    source = SAMPLE_ROOT / "pdf-pages-5000.pdf"
    if not source.exists() or int(pdf_info(source)["Pages"]) != 5000:
        large_runner.make_pdf(source, 5000)
    source_hash = matrix.sha256(source)
    tools = [tool for tool in matrix.CATALOG if tool["category"] == "PDF 工具"]
    records = []
    encrypted = None
    for index, tool in enumerate(tools, 1):
        key = tool["key"]
        log_path = LOG_ROOT / f"{key}.json"
        if os.environ.get("L3_PDF_RESUME") == "1" and log_path.exists():
            prior = json.loads(log_path.read_text(encoding="utf-8"))
            if prior.get("result") == "PASS" and prior.get("oracleComplete") is True and report_identity.resume_is_current(prior, matrix.ROOT):
                records.append(prior)
                if key == "pdf-encrypt":
                    encrypted = prior["oracles"][0]["path"]
                print(f"SKIP L3-PDF {index:02d}/{len(tools)} {key} (verified PASS log)", flush=True)
                continue
        output_dir = OUTPUT_ROOT / key
        reset(output_dir)
        if key == "pdf-decrypt" and encrypted:
            inputs = [encrypted]
        elif key == "pdf-merge":
            inputs = [str(source), str(source)]
        else:
            inputs = [str(source)]
        before = {value: matrix.sha256(value) for value in set(inputs)}
        request = {"tool": key, "inputs": inputs, "outputDir": str(output_dir), "options": matrix.default_options(tool, "")}
        execution = matrix.run_request(request, max(1800, int(tool.get("timeoutSeconds", 900))))
        record = {
            "caseId": f"{key}:L3-limit", "level": LEVEL, "tool": key,
            "scale": {"pagesPerInput": 5000, "inputCount": len(inputs)},
            "execution": {k: v for k, v in execution.items() if k not in {"stdout", "stderr"}},
            "stderr": execution["stderr"][-2000:], "sourceHashesBefore": before,
            "result": "FAIL", "oracles": []
        }
        oracle_complete = False
        try:
            response = json.loads(execution["stdout"] or "{}")
            if execution["timedOut"]:
                raise AssertionError("5000 页任务超时")
            if not response.get("ok"):
                raise AssertionError(matrix.response_error(response, execution))
            outputs = response.get("outputs") or []
            if not outputs:
                raise AssertionError("成功响应没有输出")
            record["oracles"] = validate_outputs(outputs)
            after = {value: matrix.sha256(value) for value in set(inputs)}
            record["sourceHashesAfter"] = after
            if before != after:
                raise AssertionError("源 PDF 哈希变化")
            record["outputCount"] = len(outputs)
            record["semanticOracle"] = validate_boundary_semantics(key, request, outputs, record["oracles"])
            oracle_complete = True
            record["result"] = "PASS"
            if key == "pdf-encrypt":
                encrypted = outputs[0]
        except Exception as error:
            record["error"] = str(error)
        report_identity.finalize_record(record, tool, oracle_complete=oracle_complete, root=matrix.ROOT)
        records.append(record)
        report_identity.write_evidence(log_path, record)
        print(f"{record['result']} L3-PDF {index:02d}/{len(tools)} {key}" + (f": {record.get('error')}" if record["result"] == "FAIL" else ""), flush=True)
    passed = sum(item["result"] == "PASS" for item in records)
    report = report_identity.build_report(matrix.ROOT, LEVEL, records, suite="PDF-5000-pages")
    report_identity.write_evidence(matrix.ACCEPTANCE / "L3_PDF_REPORT.json", report)
    print(f"L3 PDF SUMMARY {passed}/{len(records)} pass", flush=True)
    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
