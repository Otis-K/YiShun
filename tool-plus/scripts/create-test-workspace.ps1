param(
  [string]$WorkspaceRoot = "G:\tool-user-file"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Samples = Join-Path $ProjectRoot "work\verify\samples"
$Outputs = Join-Path $ProjectRoot "work\verify\outputs"
$RealImage = Join-Path $ProjectRoot "work\ui-check.png"

$assets = @{
  md = Join-Path $Samples "note.md"
  html = Join-Path $Samples "page.html"
  txt = Join-Path $Samples "plain.txt"
  png = $RealImage
  docx = Join-Path $Samples "doc.docx"
  xlsx = Join-Path $Samples "book.xlsx"
  pdf = Join-Path $Samples "sample.pdf"
  encryptedPdf = Join-Path $Outputs "pdf-encrypt\sample_encrypted.pdf"
  svg = Join-Path $Samples "shape.svg"
}

foreach ($asset in $assets.Values) {
  if (!(Test-Path -LiteralPath $asset)) {
    throw "Test asset not found: $asset. Run .\scripts\verify.ps1 first."
  }
}

$definitions = @(
  @{ key="markdown-to-html"; asset="md"; name="测试文档.md"; note="把 Markdown 转为 HTML。" },
  @{ key="markdown-to-txt"; asset="md"; name="测试文档.md"; note="把 Markdown 转为纯文本。" },
  @{ key="html-to-txt"; asset="html"; name="测试网页.html"; note="提取网页中的纯文本。" },
  @{ key="txt-to-html"; asset="txt"; name="测试文本.txt"; note="把文本包装为 HTML。" },
  @{ key="replace-text"; asset="txt"; name="测试文本.txt"; note="查找 foo，替换为 bar。" },
  @{ key="replace-lines"; asset="txt"; name="测试文本.txt"; note="匹配 keep，替换整行。" },
  @{ key="remove-whitespace"; asset="txt"; name="测试文本.txt"; note="测试删除空白、空行或行首尾空格。" },
  @{ key="rename-prefix-suffix"; asset="txt"; name="待重命名.txt"; note="添加 test_ 前缀和 _done 后缀；原文件会保留。" },
  @{ key="classify-extension"; asset="txt"; name="分类样例.txt"; note="按扩展名归类文件。" },
  @{ key="classify-filename"; asset="txt"; name="AB分类样例.txt"; note="按文件名前 2 个字符归类。" },
  @{ key="image-convert"; asset="png"; name="真实截图.png"; note="把真实截图转换为 JPG、PNG、BMP、GIF 或 TIFF。" },
  @{ key="image-watermark"; asset="png"; name="真实截图.png"; note="添加文字水印。" },
  @{ key="image-split"; asset="png"; name="真实截图.png"; note="按 2 行 2 列拆分。" },
  @{ key="image-edit"; asset="png"; name="真实截图.png"; note="测试缩放、裁剪、旋转和翻转。" },
  @{ key="image-metadata"; asset="png"; name="真实截图.png"; note="设置或清除标题、作者、版权、备注和关键词。" },
  @{ key="docx-replace"; asset="docx"; name="测试Word.docx"; note="把 OLD 替换为 NEW。" },
  @{ key="docx-to-txt"; asset="docx"; name="测试Word.docx"; note="提取 Word 文本。" },
  @{ key="docx-to-html"; asset="docx"; name="测试Word.docx"; note="把 Word 转为 HTML。" },
  @{ key="xlsx-replace"; asset="xlsx"; name="测试Excel.xlsx"; note="把 OLD 替换为 NEW。" },
  @{ key="xlsx-to-csv"; asset="xlsx"; name="测试Excel.xlsx"; note="把工作表导出为 CSV。" },
  @{ key="xlsx-to-json"; asset="xlsx"; name="测试Excel.xlsx"; note="把工作表导出为 JSON。" },
  @{ key="pdf-delete-pages"; asset="pdf"; name="三页测试.pdf"; note="删除第 2 页。" },
  @{ key="pdf-encrypt"; asset="pdf"; name="三页测试.pdf"; note="建议测试密码：test123。" },
  @{ key="pdf-decrypt"; asset="encryptedPdf"; name="已加密测试_密码test123.pdf"; note="解密密码：test123。" },
  @{ key="pdf-watermark"; asset="pdf"; name="三页测试.pdf"; note="添加 PDF 水印。" },
  @{ key="pdf-stamp"; asset="pdf"; name="三页测试.pdf"; note="添加右上角图章。" },
  @{ key="pdf-redact"; asset="pdf"; name="三页测试.pdf"; note="测试黑色遮盖或马赛克打码。" },
  @{ key="pdf-modify"; asset="pdf"; name="三页测试.pdf"; note="测试旋转页面，或按 3,1,2 重排。" },
  @{ key="svg-to-pdf"; asset="svg"; name="测试矢量图.svg"; note="把 SVG 转为 PDF。" },
  @{ key="svg-to-jpg"; asset="svg"; name="测试矢量图.svg"; note="把 SVG 转为 JPG。" },
  @{ key="pdf-to-txt"; asset="pdf"; name="三页测试.pdf"; note="提取 PDF 文本。" },
  @{ key="pdf-to-jpg"; asset="pdf"; name="三页测试.pdf"; note="把每一页渲染为 JPG。" },
  @{ key="pdf-add-margin"; asset="pdf"; name="三页测试.pdf"; note="增加 36 pt 页面边距。" },
  @{ key="web-video-download"; asset=$null; name="公开网页视频地址.txt"; note="把文件中的地址复制到工具。仅下载有权保存的公开内容。" }
)

foreach ($definition in $definitions) {
  $toolRoot = Join-Path $WorkspaceRoot $definition.key
  $inputDir = Join-Path $toolRoot "input"
  $outputDir = Join-Path $toolRoot "output"
  New-Item -ItemType Directory -Force -Path $inputDir, $outputDir | Out-Null
  if ($definition.asset) {
    Copy-Item -LiteralPath $assets[$definition.asset] -Destination (Join-Path $inputDir $definition.name) -Force
  } else {
    Set-Content -LiteralPath (Join-Path $inputDir $definition.name) -Value "https://www.w3schools.com/html/html5_video.asp" -Encoding utf8
  }
  Set-Content -LiteralPath (Join-Path $inputDir "测试说明.txt") -Value $definition.note -Encoding utf8
}

Write-Host "Created $($definitions.Count) external test workspaces under $WorkspaceRoot"
