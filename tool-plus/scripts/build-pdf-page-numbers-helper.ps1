$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PythonCandidates = @(@(
  $env:TOOLPLUS_PDF_HELPER_PYTHON,
  (Join-Path $Root ".tools\pdf-helper-venv\Scripts\python.exe"),
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_) })
if ($PythonCandidates.Count -eq 0) {
  throw "PDF page numbers helper Python environment not found. Create .tools\pdf-helper-venv and install python_pdf_helper\requirements.txt."
}
$Python = $PythonCandidates[0]
& $Python -c "import PyInstaller, pypdf, reportlab"
if ($LASTEXITCODE -ne 0) {
  throw "PDF helper build dependencies are missing. Install python_pdf_helper\requirements.txt into $Python."
}
Set-Location $Root
New-Item -ItemType Directory -Force "bin" | Out-Null
& $Python "python_pdf_helper\regression_test.py"
if ($LASTEXITCODE -ne 0) {
  throw "PDF helper source regression failed with exit code $LASTEXITCODE"
}
& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --specpath "build" `
  --name "pdf-page-numbers-helper" `
  --collect-all "reportlab" `
  --collect-all "pypdf" `
  "python_pdf_helper\main.py"
if ($LASTEXITCODE -ne 0) {
  throw "PDF page numbers helper build failed with exit code $LASTEXITCODE"
}
Copy-Item -Force "dist\pdf-page-numbers-helper.exe" "bin\pdf-page-numbers-helper.exe"
& $Python "python_pdf_helper\regression_test.py" --helper "bin\pdf-page-numbers-helper.exe"
if ($LASTEXITCODE -ne 0) {
  throw "PDF helper executable regression failed with exit code $LASTEXITCODE"
}
Write-Host "PDF page numbers helper built: $Root\bin\pdf-page-numbers-helper.exe"
