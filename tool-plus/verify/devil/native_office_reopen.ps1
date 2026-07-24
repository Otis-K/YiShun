param([Parameter(Mandatory=$true)][string]$Path)

$ErrorActionPreference = 'Stop'
$full = (Resolve-Path -LiteralPath $Path).Path
$extension = [IO.Path]::GetExtension($full).ToLowerInvariant()
$app = $null
$document = $null
$result = [ordered]@{ path=$full; extension=$extension; opened=$false; objectCount=0 }
try {
  switch ($extension) {
    '.docx' {
      $app = New-Object -ComObject Word.Application
      $app.Visible = $false
      $app.DisplayAlerts = 0
      $document = $app.Documents.Open($full, $false, $true, $false)
      $result.opened = $true
      $result.objectCount = $document.InlineShapes.Count + $document.Shapes.Count
    }
    '.xlsx' {
      $app = New-Object -ComObject Excel.Application
      $app.Visible = $false
      $app.DisplayAlerts = $false
      $document = $app.Workbooks.Open($full, 0, $false)
      $result.opened = $true
      $result.objectCount = $document.Worksheets.Count
    }
    '.pptx' {
      $app = New-Object -ComObject PowerPoint.Application
      $document = $app.Presentations.Open($full, $true, $false, $false)
      $result.opened = $true
      $result.objectCount = $document.Slides.Count
    }
    default { throw "Unsupported Office extension: $extension" }
  }
  $result | ConvertTo-Json -Compress
} finally {
  if ($document) {
    try { if ($extension -eq '.pptx') { $document.Close() } else { $document.Close($false) } } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch {}
  }
  if ($app) { try { $app.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
