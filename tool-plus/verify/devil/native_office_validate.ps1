param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$false)][string]$ProgressPath
)

$ErrorActionPreference = 'Stop'
$full = (Resolve-Path -LiteralPath $Path).Path
$extension = [IO.Path]::GetExtension($full).ToLowerInvariant()
$copy = Join-Path ([IO.Path]::GetDirectoryName($full)) ('native-roundtrip-' + [guid]::NewGuid().ToString('N') + $extension)
$app = $null
$document = $null
$result = [ordered]@{ path=$full; copyPath=$copy; extension=$extension; opened=$false; savedCopy=$false; reopenedCopy=$false; objectCount=0 }
function Set-ValidationStage([string]$Stage) {
  if ($ProgressPath) {
    [IO.File]::WriteAllText($ProgressPath, $Stage, [Text.UTF8Encoding]::new($false))
  }
}
try {
  Set-ValidationStage 'copying-input'
  [IO.File]::Copy($full, $copy, $false)
  $result.savedCopy = Test-Path -LiteralPath $copy
  Set-ValidationStage 'creating-application'
  switch ($extension) {
    '.docx' {
      $app = New-Object -ComObject Word.Application
      $app.Visible = $false
      $app.DisplayAlerts = 0
      Set-ValidationStage 'opening-input'
      $document = $app.Documents.Open($copy, $false, $false, $false)
      $result.opened = $true
      $result.objectCount = $document.InlineShapes.Count + $document.Shapes.Count
      Set-ValidationStage 'saving-native'
      $document.Save()
      $document.Close(0)
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
      $document = $null
    }
    '.xlsx' {
      $app = New-Object -ComObject Excel.Application
      $app.Visible = $false
      $app.DisplayAlerts = $false
      Set-ValidationStage 'opening-input'
      $document = $app.Workbooks.Open($copy, 0, $false)
      $result.opened = $true
      $result.objectCount = $document.Worksheets.Count
      Set-ValidationStage 'saving-native'
      $document.Save()
      $document.Close($false)
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
      $document = $null
    }
    '.pptx' {
      $app = New-Object -ComObject PowerPoint.Application
      Set-ValidationStage 'opening-input'
      $document = $app.Presentations.Open($copy, $false, $false, $false)
      $result.opened = $true
      $result.objectCount = $document.Slides.Count
      Set-ValidationStage 'saving-native'
      $document.Save()
      $document.Close()
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
      $document = $null
    }
    default { throw "Unsupported Office extension: $extension" }
  }
  Set-ValidationStage 'complete'
  $result | ConvertTo-Json -Compress
} finally {
  if ($document) {
    try { if ($extension -eq '.pptx') { $document.Close() } else { $document.Close($false) } } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch {}
  }
  if ($app) { try { $app.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
