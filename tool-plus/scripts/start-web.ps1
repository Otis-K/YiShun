$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "bin\flowcanvas-backend.exe"
if (-not (Test-Path $Backend)) {
  & (Join-Path $PSScriptRoot "build-web-backend.ps1")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Set-Location $Root
& node "web\server.js"
exit $LASTEXITCODE
