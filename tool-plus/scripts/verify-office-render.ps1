param(
  [string]$StressRoot = 'G:\tool-user-file\stress-0.4.0'
)

$ErrorActionPreference = 'Stop'
$qa = Join-Path $StressRoot 'qa-office'
New-Item -ItemType Directory -Force $qa | Out-Null
$pdfToPpm = 'C:\Users\祺\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$kind, [string]$input, [string]$output, [int]$rendered) {
  $results.Add([pscustomobject]@{ kind=$kind; input=$input; output=$output; renderedPages=$rendered; status='PASS' })
}

function Render-Pdf([string]$pdf, [string]$dir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $prefix = Join-Path $dir 'page'
  & $pdfToPpm -png -r 110 $pdf $prefix
  if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed: $pdf" }
  return @(Get-ChildItem $dir -Filter 'page-*.png').Count
}

$wordFiles = @(
  (Join-Path $StressRoot 'outputs\docx-remove-images\preserve-document\real-word-17-images_images_removed.docx'),
  (Join-Path $StressRoot 'outputs\docx-replace-images\preserve-layout\real-word-17-images_images_replaced.docx')
)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($input in $wordFiles) {
    if (-not (Test-Path $input)) { throw "Word output missing: $input" }
    $stem = [IO.Path]::GetFileNameWithoutExtension($input)
    $pdf = Join-Path $qa ($stem + '.pdf')
    $doc = $word.Documents.Open($input, $false, $true, $false)
    try { $doc.SaveAs2($pdf, 17) } finally { $doc.Close($false) }
    $rendered = Render-Pdf $pdf (Join-Path $qa $stem)
    Add-Result 'DOCX' $input $pdf $rendered
  }
} finally { $word.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }

$excelFiles = @(
  (Join-Path $StressRoot 'outputs\xlsx-remove-images\preserve-document\large-excel-20-images_images_removed.xlsx'),
  (Join-Path $StressRoot 'outputs\xlsx-replace-images\preserve-layout\large-excel-20-images_images_replaced.xlsx')
)
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  foreach ($input in $excelFiles) {
    if (-not (Test-Path $input)) { throw "Excel output missing: $input" }
    $stem = [IO.Path]::GetFileNameWithoutExtension($input)
    $pdf = Join-Path $qa ($stem + '.pdf')
    $book = $excel.Workbooks.Open($input, 0, $true)
    try {
      foreach ($sheet in @($book.Worksheets)) {
        $sheet.PageSetup.PrintArea = '$A$1:$P$100'
        $sheet.PageSetup.Zoom = $false
        $sheet.PageSetup.FitToPagesWide = 1
        $sheet.PageSetup.FitToPagesTall = 2
      }
      $book.ExportAsFixedFormat(0, $pdf)
    } finally { $book.Close($false) }
    $rendered = Render-Pdf $pdf (Join-Path $qa $stem)
    Add-Result 'XLSX' $input $pdf $rendered
  }
} finally { $excel.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }

$pptFiles = @(
  (Join-Path $StressRoot 'outputs\pptx-remove-images\preserve-document\real-ppt-28-images_images_removed.pptx'),
  (Join-Path $StressRoot 'outputs\pptx-replace-images\preserve-layout\real-ppt-28-images_images_replaced.pptx')
)
$powerPoint = New-Object -ComObject PowerPoint.Application
try {
  foreach ($input in $pptFiles) {
    if (-not (Test-Path $input)) { throw "PowerPoint output missing: $input" }
    $stem = [IO.Path]::GetFileNameWithoutExtension($input)
    $dir = Join-Path $qa $stem
    New-Item -ItemType Directory -Force $dir | Out-Null
    $deck = $powerPoint.Presentations.Open($input, $true, $true, $false)
    try { $deck.Export($dir, 'PNG', 1600, 900); $count = $deck.Slides.Count } finally { $deck.Close() }
    $rendered = @(Get-ChildItem $dir -Filter '*.PNG').Count
    if ($rendered -ne $count) { throw "PowerPoint rendered $rendered of $count slides: $input" }
    Add-Result 'PPTX' $input $dir $rendered
  }
} finally { $powerPoint.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null }

$summary = [pscustomobject]@{ status='PASS'; generatedAt=(Get-Date).ToString('o'); results=$results }
$summary | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $qa 'OFFICE_RENDER_REPORT.json')
$summary | ConvertTo-Json -Depth 5
