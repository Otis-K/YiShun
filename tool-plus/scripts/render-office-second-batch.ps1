$ErrorActionPreference = 'Stop'

$Root = 'G:\tool-user-file\stress-0.4.0'
$Samples = Join-Path $Root 'samples'
$Outputs = Join-Path $Root 'outputs'
$Visual = Join-Path $Root 'visual-qa'
New-Item -ItemType Directory -Force -Path $Visual | Out-Null

function One-File([string]$Path, [string]$Filter) {
  $items = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Filter $Filter)
  if ($items.Count -ne 1) { throw "Expected one $Filter below $Path, got $($items.Count)" }
  return $items[0].FullName
}

$summary = [ordered]@{ word = @(); excel = @(); powerpoint = @() }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.AutomationSecurity = 3
$word.Options.UpdateLinksAtOpen = $false
try {
  $wordInputs = [ordered]@{
    source = Join-Path $Samples 'real-word-17-images.docx'
    removed = One-File (Join-Path $Outputs 'docx-remove-images') '*.docx'
    replaced = One-File (Join-Path $Outputs 'docx-replace-images') '*.docx'
  }
  foreach ($entry in $wordInputs.GetEnumerator()) {
    $doc = $word.Documents.Open($entry.Value, $false, $true, $false)
    try {
      $pages = $doc.ComputeStatistics(2)
      $summary.word += [ordered]@{ variant = $entry.Key; pages = $pages; paragraphs = $doc.Paragraphs.Count; nativeOpen = $true; visualRender = 'skipped-word-pdf-export-timeout' }
    } finally { $doc.Close(0) }
  }
} finally {
  $word.Quit()
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$excel.AutomationSecurity = 3
try {
  $excelInputs = [ordered]@{
    source = Join-Path $Samples 'large-excel-20-images.xlsx'
    removed = One-File (Join-Path $Outputs 'xlsx-remove-images') '*.xlsx'
    replaced = One-File (Join-Path $Outputs 'xlsx-replace-images') '*.xlsx'
  }
  foreach ($entry in $excelInputs.GetEnumerator()) {
    $book = $excel.Workbooks.Open($entry.Value, 0, $true)
    try {
      $sheets = $book.Worksheets.Count
      $rows = 0
      foreach ($sheet in $book.Worksheets) {
        $rows += $sheet.UsedRange.Rows.Count
        $sheet.PageSetup.PrintArea = '$A$1:$K$60'
        $sheet.PageSetup.Zoom = $false
        $sheet.PageSetup.FitToPagesWide = 1
        $sheet.PageSetup.FitToPagesTall = 1
      }
      $pdf = Join-Path $Visual ("excel-{0}.pdf" -f $entry.Key)
      $book.ExportAsFixedFormat(0, $pdf, 0, $true, $false)
      $summary.excel += [ordered]@{ variant = $entry.Key; sheets = $sheets; usedRows = $rows; pdf = $pdf; bytes = (Get-Item $pdf).Length }
    } finally { $book.Close($false) }
  }
} finally {
  $excel.Quit()
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) | Out-Null
}

$powerpoint = New-Object -ComObject PowerPoint.Application
$powerpoint.AutomationSecurity = 3
try {
  $pptInputs = [ordered]@{
    source = Join-Path $Samples 'real-ppt-28-images.pptx'
    removed = One-File (Join-Path $Outputs 'pptx-remove-images') '*.pptx'
    replaced = One-File (Join-Path $Outputs 'pptx-replace-images') '*.pptx'
  }
  foreach ($entry in $pptInputs.GetEnumerator()) {
    $deck = $powerpoint.Presentations.Open($entry.Value, $true, $false, $false)
    try {
      $slides = $deck.Slides.Count
      $pdf = Join-Path $Visual ("powerpoint-{0}.pdf" -f $entry.Key)
      $deck.SaveAs($pdf, 32)
      $previewDir = Join-Path $Visual ("powerpoint-{0}-png" -f $entry.Key)
      New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
      $deck.Export($previewDir, 'PNG', 1280, 720)
      $pngCount = @(Get-ChildItem -LiteralPath $previewDir -File -Filter '*.PNG').Count
      $summary.powerpoint += [ordered]@{ variant = $entry.Key; slides = $slides; pngs = $pngCount; pdf = $pdf; bytes = (Get-Item $pdf).Length }
    } finally { $deck.Close() }
  }
} finally {
  $powerpoint.Quit()
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerpoint) | Out-Null
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Visual 'OFFICE_RENDER_REPORT.json') -Encoding UTF8
$summary | ConvertTo-Json -Depth 6
