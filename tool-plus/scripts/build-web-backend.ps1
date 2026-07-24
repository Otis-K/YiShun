$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Workspace = Split-Path -Parent $Root
$BackendRoot = Join-Path $Workspace "backend-sdk"
$ToolsRoot = Join-Path $Root ".tools"
$GoRoot = Join-Path $ToolsRoot "go"
$Go = Join-Path $GoRoot "bin\go.exe"
$BundledGoComplete = (Test-Path $Go) `
  -and (Test-Path (Join-Path $GoRoot "src\context\context.go")) `
  -and (Test-Path (Join-Path $GoRoot "src\net\http\server.go")) `
  -and (Test-Path (Join-Path $GoRoot "src\sync\mutex.go")) `
  -and (Test-Path (Join-Path $GoRoot "src\time\time.go")) `
  -and (Test-Path (Join-Path $GoRoot "src\unsafe\unsafe.go"))

if (-not $BundledGoComplete) {
  $SystemGo = Get-Command go.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
  $SystemGoIsBrokenCache = $SystemGo -and [IO.Path]::GetFullPath($SystemGo).StartsWith([IO.Path]::GetFullPath($GoRoot) + '\', [StringComparison]::OrdinalIgnoreCase)
  if ($SystemGo -and -not $SystemGoIsBrokenCache) {
    $Go = $SystemGo
  } else {
    Write-Host "Go toolchain not found; downloading the current official Windows amd64 release..."
    $Releases = Invoke-RestMethod -Uri "https://go.dev/dl/?mode=json" -UseBasicParsing
    $Release = $Releases | Where-Object { $_.stable } | Select-Object -First 1
    $File = $Release.files | Where-Object { $_.os -eq "windows" -and $_.arch -eq "amd64" -and $_.kind -eq "archive" } | Select-Object -First 1
    if (-not $File) { throw "Official Go Windows amd64 archive was not found." }
    New-Item -ItemType Directory -Force $ToolsRoot | Out-Null
    $Archive = Join-Path $ToolsRoot $File.filename
    Invoke-WebRequest -Uri ("https://go.dev/dl/" + $File.filename) -OutFile $Archive -UseBasicParsing
    $ActualHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $File.sha256.ToLowerInvariant()) { throw "Downloaded Go archive hash verification failed." }
    if (Test-Path $GoRoot) {
      $ResolvedTools = [IO.Path]::GetFullPath($ToolsRoot).TrimEnd('\')
      $ResolvedGo = [IO.Path]::GetFullPath($GoRoot)
      if (-not $ResolvedGo.StartsWith($ResolvedTools + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Go cache path: $ResolvedGo" }
      Remove-Item -LiteralPath $ResolvedGo -Recurse -Force
    }
    Expand-Archive -LiteralPath $Archive -DestinationPath $ToolsRoot -Force
    Remove-Item -LiteralPath $Archive -Force
  }
}

if (-not (Test-Path (Join-Path $BackendRoot "go.mod"))) { throw "Backend SDK not found: $BackendRoot" }
$Output = Join-Path $Root "bin\flowcanvas-backend.exe"
New-Item -ItemType Directory -Force (Split-Path $Output) | Out-Null
$env:PATH = (Split-Path $Go) + ";" + $env:PATH
$env:GOPROXY = "https://goproxy.cn,direct"
Push-Location $BackendRoot
try {
  & $Go test ".\models" ".\providers\tmlabtasks" ".\cmd\toolplus"
  if ($LASTEXITCODE -ne 0) { throw "FlowCanvas backend tests failed with exit code $LASTEXITCODE" }
  & $Go build -buildvcs=false -trimpath -ldflags "-s -w" -o $Output ".\cmd\toolplus"
  if ($LASTEXITCODE -ne 0) { throw "FlowCanvas backend build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Host "FlowCanvas Web backend built: $Output"
