$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Go = Join-Path $Root ".tools\go\bin\go.exe"
$env:PATH = (Split-Path $Go) + ";" + $env:PATH
$env:GOPROXY = "https://goproxy.cn,direct"
Set-Location $Root
$PdfHelper = Join-Path $Root "bin\pdf-page-numbers-helper.exe"
if (-not (Test-Path -LiteralPath $PdfHelper)) {
  throw "PDF page numbers helper missing: $PdfHelper"
}
$PythonCandidates = @(@(
  $env:TOOLPLUS_PDF_HELPER_PYTHON,
  (Join-Path $Root ".tools\pdf-helper-venv\Scripts\python.exe"),
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_) })
if ($PythonCandidates.Count -eq 0) {
  throw "PDF helper verification Python environment not found"
}
$Python = $PythonCandidates[0]
& $Python "python_pdf_helper\regression_test.py"
if ($LASTEXITCODE -ne 0) {
  throw "PDF helper source regression failed with exit code $LASTEXITCODE"
}
& $Python "python_pdf_helper\regression_test.py" --helper $PdfHelper
if ($LASTEXITCODE -ne 0) {
  throw "PDF helper executable regression failed with exit code $LASTEXITCODE"
}
& "$PSScriptRoot\build-backend.ps1"
if ($LASTEXITCODE -ne 0) {
  throw "build-backend failed with exit code $LASTEXITCODE"
}
& $Go run .\verify
if ($LASTEXITCODE -ne 0) {
  throw "Go regression verification failed with exit code $LASTEXITCODE"
}
$Electron = Join-Path $Root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $Electron)) {
  throw "Electron runtime missing: $Electron"
}
$env:ELECTRON_RUN_AS_NODE = "1"
try {
  & $Electron "$PSScriptRoot\verify-frontend-catalog.js"
  if ($LASTEXITCODE -ne 0) {
    throw "frontend catalog verification failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
