$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ExistingBridge = Join-Path $Root "bin\python-bridge.exe"

$PythonCandidates = @(@(
  $env:TOOLPLUS_PYTHON,
  (Join-Path $Root ".venv\Scripts\python.exe"),
  "D:\tool\.venv\Scripts\python.exe"
) | Where-Object { $_ -and (Test-Path $_) })

$ToolRootCandidates = @(@(
  $env:TOOLPLUS_TOOL_ROOT,
  (Join-Path $Root "vendor\batchtool-root"),
  "D:\tool"
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "batchtool")) })

if ($PythonCandidates.Count -eq 0 -or $ToolRootCandidates.Count -eq 0) {
  if (Test-Path $ExistingBridge) {
    Write-Warning "Python source environment is unavailable; reusing verified bridge: $ExistingBridge"
    exit 0
  }
  throw "Python bridge cannot be built: set TOOLPLUS_PYTHON and TOOLPLUS_TOOL_ROOT, or provide $ExistingBridge"
}

$Python = $PythonCandidates[0]
$ToolRoot = $ToolRootCandidates[0]
Set-Location $Root
New-Item -ItemType Directory -Force "bin" | Out-Null
& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name "python-bridge" `
  --paths $ToolRoot `
  --collect-submodules "batchtool" `
  "python_bridge\bridge.py"
if ($LASTEXITCODE -ne 0) {
  throw "Python bridge build failed with exit code $LASTEXITCODE"
}
Copy-Item -Force "dist\python-bridge.exe" "bin\python-bridge.exe"
Write-Host "python bridge built: $Root\bin\python-bridge.exe"
