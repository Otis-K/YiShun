param(
  [string]$WorkspaceRoot = "G:\tool-user-file",
  [string]$StressRoot = "G:\tool-user-file\stress-0.3.0"
)

$ErrorActionPreference = "Stop"
$samples = Join-Path $StressRoot "samples"
$text = Join-Path $samples "超长中文日志-64MiB.txt"
$image = Join-Path $samples "高分辨率图片-7000x5000.png"
$pdf = Join-Path $samples "长文档-400页.pdf"
$video = Join-Path $samples "高清视频-1080p-30秒.mp4"
$watermark = Join-Path $samples "水印.png"
$folder = Join-Path $samples "多层目录-1000文件"
$audio = Join-Path $StressRoot "outputs\video-extract-audio\高清视频-1080p-30秒.mp3"
$html = Join-Path $samples "大内容网页.html"

foreach ($required in @($text, $image, $pdf, $video, $watermark, $folder, $audio)) {
  if (!(Test-Path -LiteralPath $required)) { throw "Missing stress sample: $required" }
}

if (!(Test-Path -LiteralPath $html)) {
  $writer = [System.IO.StreamWriter]::new($html, $false, [System.Text.UTF8Encoding]::new($false))
  try {
    $writer.WriteLine('<!doctype html><html><meta charset="utf-8"><body><h1>大内容网页压力样本</h1>')
    for ($i = 1; $i -le 160000; $i++) {
      $writer.WriteLine("<section><h2>章节 $i</h2><p>这是包含大量正文、链接和强调内容的 HTML 压力测试段落 <strong>ToolPlus</strong> <a href=`"https://example.com/$i`">链接</a>。</p></section>")
    }
    $writer.WriteLine('</body></html>')
  } finally {
    $writer.Dispose()
  }
}

function Add-HardLink([string]$Tool, [string]$Source, [string]$Name) {
  $input = Join-Path $WorkspaceRoot "$Tool\input"
  New-Item -ItemType Directory -Force $input | Out-Null
  $target = Join-Path $input $Name
  if (!(Test-Path -LiteralPath $target)) {
    New-Item -ItemType HardLink -Path $target -Target $Source | Out-Null
  }
}

function Add-FolderLink([string]$Tool) {
  $input = Join-Path $WorkspaceRoot "$Tool\input"
  New-Item -ItemType Directory -Force $input | Out-Null
  $target = Join-Path $input "多层目录-1000文件"
  if (!(Test-Path -LiteralPath $target)) {
    New-Item -ItemType Junction -Path $target -Target $folder | Out-Null
  }
}

foreach ($tool in @('txt-to-markdown', 'text-encoding', 'modify-file-times', 'rename-replace', 'rename-insert', 'rename-parent', 'rename-case', 'rename-delete')) {
  Add-HardLink $tool $text "超长中文日志-64MiB.txt"
}
Add-HardLink 'markdown-to-pdf' $text "大内容Markdown-64MiB.md"
Add-HardLink 'html-to-markdown' $html "大内容网页.html"
Add-HardLink 'merge-text' $text "合并输入-A-64MiB.txt"
Add-HardLink 'merge-text' $text "合并输入-B-64MiB.txt"

foreach ($tool in @('folder-replace', 'folder-insert', 'folder-prefix-suffix', 'folder-case', 'folder-delete', 'mirror-folders')) { Add-FolderLink $tool }
foreach ($tool in @('image-enhance', 'image-resize', 'image-crop', 'image-rotate', 'image-compress')) { Add-HardLink $tool $image "高分辨率图片-7000x5000.png" }
foreach ($tool in @('pdf-split', 'pdf-rotate', 'pdf-reorder', 'pdf-extract-pages', 'pdf-odd-even')) { Add-HardLink $tool $pdf "长文档-400页.pdf" }
Add-HardLink 'pdf-merge' $pdf "合并输入-A-400页.pdf"
Add-HardLink 'pdf-merge' $pdf "合并输入-B-400页.pdf"

foreach ($tool in @('video-extract-audio', 'video-remove-audio', 'video-preview-grid', 'video-text-watermark', 'video-to-mp4', 'video-to-avi', 'video-to-mkv', 'video-to-mov', 'video-to-flv', 'video-to-wmv', 'video-to-webm', 'video-to-mpeg', 'video-to-3gp', 'video-to-ogv', 'video-to-ts')) {
  Add-HardLink $tool $video "高清视频-1080p-30秒.mp4"
}
Add-HardLink 'video-image-watermark' $video "01-高清视频-1080p-30秒.mp4"
Add-HardLink 'video-image-watermark' $watermark "02-水印图片.png"
foreach ($tool in @('audio-to-mp3', 'audio-to-aac', 'audio-to-m4a', 'audio-to-wma', 'audio-to-wav', 'audio-to-flac', 'audio-to-ogg', 'audio-to-opus')) { Add-HardLink $tool $audio "真实音频样本.mp3" }

Write-Host "Linked first-batch stress inputs into $WorkspaceRoot"
