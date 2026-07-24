$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$GoCandidates = @(@(
  $env:TOOLPLUS_GO,
  (Join-Path $Root ".tools\go\bin\go.exe"),
  (Get-Command go.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_) })
if ($GoCandidates.Count -eq 0) {
  throw "Go toolchain not found: set TOOLPLUS_GO or install Go 1.26+"
}
$Go = $GoCandidates[0]
$Engine = Join-Path $Root "bin\toolplus-engine.exe"
if (!(Test-Path $Engine)) {
  throw "Compatibility processing engine not found: $Engine"
}
$env:PATH = (Split-Path $Go) + ";" + $env:PATH
$env:GOPROXY = "https://goproxy.cn,direct"
Set-Location $Root
New-Item -ItemType Directory -Force "bin" | Out-Null
& $Go build -buildvcs=false -trimpath -ldflags "-s -w" -o "bin\toolplus-backend.exe" ".\backend"
if ($LASTEXITCODE -ne 0) {
  throw "Go backend build failed with exit code $LASTEXITCODE"
}
Write-Host "backend built: $Root\bin\toolplus-backend.exe"

$FlowCanvasBackendRoot = $env:FLOWCANVAS_BACKEND_SDK_ROOT
if (-not $FlowCanvasBackendRoot) {
  $FlowCanvasBackendRoot = Join-Path ([IO.Path]::GetPathRoot($Root)) "FlowCanvas-SDK\FlowCanvas-Backend-SDK"
}
if (-not (Test-Path -LiteralPath (Join-Path $FlowCanvasBackendRoot "go.mod"))) {
  throw "FlowCanvas Backend SDK not found: set FLOWCANVAS_BACKEND_SDK_ROOT (expected $FlowCanvasBackendRoot)"
}
Push-Location $FlowCanvasBackendRoot
try {
  & $Go test ".\models" ".\providers\tmlabtasks" ".\cmd\toolplus"
  if ($LASTEXITCODE -ne 0) {
    throw "FlowCanvas model adapter tests failed with exit code $LASTEXITCODE"
  }
  & $Go build -buildvcs=false -trimpath -ldflags "-s -w" -o (Join-Path $Root "bin\flowcanvas-backend.exe") ".\cmd\toolplus"
  if ($LASTEXITCODE -ne 0) {
    throw "FlowCanvas backend build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
Write-Host "FlowCanvas backend built: $Root\bin\flowcanvas-backend.exe"
