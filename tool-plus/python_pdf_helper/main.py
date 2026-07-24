from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


FONT_NAME = "STSong-Light"
DEFAULT_FORMAT = "第 %p 页 / 共 %P 页"
DEFAULT_POSITION = "底部居中"
MAX_PAGES = 5000
pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))
POSITIONS = {
    "底部左侧": ("left", "bottom"),
    "底部居中": ("center", "bottom"),
    "底部右侧": ("right", "bottom"),
    "顶部左侧": ("left", "top"),
    "顶部居中": ("center", "top"),
    "顶部右侧": ("right", "top"),
}


def bounded_int(value: object, default: int, minimum: int, maximum: int, name: str) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} 必须是整数") from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} 必须在 {minimum} 到 {maximum} 之间")
    return parsed


def page_text(template: str, page_number: int, total_pages: int) -> str:
    return template.replace("%P", str(total_pages)).replace("%p", str(page_number))


def overlay_document(page_specs: list[tuple[float, float, str]], font_size: int, position: str):
    buffer = io.BytesIO()
    first_size = page_specs[0][:2]
    pdf = canvas.Canvas(buffer, pagesize=first_size, pageCompression=1)
    horizontal, vertical = POSITIONS[position]
    margin = max(24.0, font_size * 1.8)
    for width, height, text in page_specs:
        pdf.setPageSize((width, height))
        pdf.setFont(FONT_NAME, font_size)
        text_width = pdfmetrics.stringWidth(text, FONT_NAME, font_size)
        if horizontal == "left":
            x = margin
        elif horizontal == "right":
            x = max(margin, width - margin - text_width)
        else:
            x = max(margin, (width - text_width) / 2)
        y = margin if vertical == "bottom" else max(margin, height - margin - font_size)
        pdf.drawString(x, y, text)
        pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer), buffer


def unique_output_path(output_dir: Path, source: Path, reserved: set[Path]) -> Path:
    candidate = output_dir / f"{source.stem}_numbered.pdf"
    index = 2
    while candidate in reserved or candidate.exists():
        candidate = output_dir / f"{source.stem}_numbered_{index}.pdf"
        index += 1
    reserved.add(candidate)
    return candidate


def isolate_page_state(page) -> None:
    contents_key = NameObject("/Contents")
    if contents_key in page:
        contents = page.get_contents()
        if contents is not None:
            isolated = DecodedStreamObject()
            isolated.set_data(contents.get_data())
            page[contents_key] = isolated.flate_encode()
    resources_key = NameObject("/Resources")
    if resources_key in page:
        resources = page[resources_key].get_object()
        isolated_resources = DictionaryObject()
        for key, value in resources.items():
            resolved = value.get_object()
            if isinstance(resolved, DictionaryObject):
                isolated_resources[key] = DictionaryObject(
                    {nested_key: nested_value for nested_key, nested_value in resolved.items()}
                )
            else:
                isolated_resources[key] = value
        page[resources_key] = isolated_resources


def number_pdf(source: Path, output: Path, options: dict[str, object]) -> None:
    reader = PdfReader(source)
    if reader.is_encrypted:
        password = str(options.get("password") or "")
        if not password or reader.decrypt(password) == 0:
            raise ValueError(f"加密 PDF 无法添加页码: {source}")
    total_pages = len(reader.pages)
    if total_pages < 1:
        raise ValueError(f"PDF 没有可处理页面: {source}")
    if total_pages > MAX_PAGES:
        raise ValueError(f"PDF 页数 {total_pages} 超过上限 {MAX_PAGES}: {source}")

    template = str(options.get("format") or DEFAULT_FORMAT)
    if not template.strip():
        raise ValueError("页码格式不能为空")
    position = str(options.get("position") or DEFAULT_POSITION)
    if position not in POSITIONS:
        raise ValueError(f"不支持的页码位置: {position}")
    font_size = bounded_int(options.get("fontSize", 10), 10, 6, 72, "字号")
    start = bounded_int(options.get("start", 1), 1, 0, 100000, "起始编号")

    writer = PdfWriter(clone_from=reader)
    pages = []
    page_specs = []
    for index, original in enumerate(writer.pages):
        page = original
        isolate_page_state(page)
        if page.rotation:
            page.transfer_rotation_to_content()
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        text = page_text(template, start + index, total_pages)
        pages.append(page)
        page_specs.append((width, height, text))

    overlays, overlay_buffer = overlay_document(page_specs, font_size, position)
    for page, overlay in zip(pages, overlays.pages, strict=True):
        page.merge_page(overlay, over=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    try:
        with temporary.open("wb") as stream:
            writer.write(stream)
        temporary.replace(output)
    finally:
        overlay_buffer.close()
        temporary.unlink(missing_ok=True)


def main() -> int:
    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        request = json.load(sys.stdin)
        if request.get("tool") != "pdf-page-numbers":
            raise ValueError("辅助程序只支持 pdf-page-numbers")
        inputs = [Path(value).resolve() for value in request.get("inputs") or []]
        if not inputs:
            raise ValueError("请至少选择一个 PDF 文件")
        output_dir_value = request.get("outputDir")
        if not output_dir_value:
            raise ValueError("缺少输出目录")
        output_dir = Path(output_dir_value).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        options = dict(request.get("options") or {})
        outputs: list[str] = []
        reserved: set[Path] = set()
        for source in inputs:
            if not source.is_file():
                raise FileNotFoundError(f"PDF 文件不存在: {source}")
            if source.suffix.lower() != ".pdf":
                raise ValueError(f"只支持 PDF 文件: {source}")
            target = unique_output_path(output_dir, source, reserved)
            number_pdf(source, target, options)
            outputs.append(str(target))
        print(json.dumps({"ok": True, "outputs": outputs}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
