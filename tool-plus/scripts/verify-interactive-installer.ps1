param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [switch]$OneClick
)

$ErrorActionPreference = 'Stop'
$tempRoot = 'G:\tool-plus-v2\tmp\interactive-installer'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$env:TEMP = $tempRoot
$env:TMP = $tempRoot

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  static string Text(IntPtr h) { var s=new StringBuilder(512); GetWindowText(h,s,s.Capacity); return s.ToString(); }
  static string Class(IntPtr h) { var s=new StringBuilder(128); GetClassName(h,s,s.Capacity); return s.ToString(); }
  public static string[] InstallerTexts() {
    var rows=new List<string>();
    EnumWindows((h,p)=>{
      var title=Text(h);
      if (IsWindowVisible(h) && title.Contains("文档批量处理工具") && title.Contains("安装")) {
        rows.Add("WINDOW:"+title);
        EnumChildWindows(h,(c,q)=>{ if(IsWindowVisible(c)) rows.Add(Class(c)+":"+Text(c)); return true; },IntPtr.Zero);
      }
      return true;
    },IntPtr.Zero);
    return rows.ToArray();
  }
  public static bool ClickButton(string expected) {
    bool clicked=false;
    EnumWindows((h,p)=>{
      var title=Text(h);
      if (clicked || !IsWindowVisible(h) || !title.Contains("文档批量处理工具") || !title.Contains("安装")) return true;
      EnumChildWindows(h,(c,q)=>{
        // NSIS 3 owner-drawn controls are exposed as Pane by UI Automation on
        // current Windows builds even though BM_CLICK is still the correct
        // activation message, so do not require the native Button class.
        if (!clicked && IsWindowVisible(c) && Text(c).Contains(expected)) {
          SendMessage(c,0x00F5,IntPtr.Zero,IntPtr.Zero); clicked=true; return false;
        }
        return true;
      },IntPtr.Zero);
      return true;
    },IntPtr.Zero);
    return clicked;
  }
}
'@

$appExe = Join-Path $InstallDir '文档批量处理工具.exe'
if (Test-Path $appExe) {
  Start-Process -FilePath $appExe | Out-Null
  Start-Sleep -Seconds 5
}

$process = if ($OneClick) {
  Start-Process -FilePath $Installer -PassThru
} else {
  Start-Process -FilePath $Installer -ArgumentList "/D=$InstallDir" -PassThru
}
$keyboard = New-Object -ComObject WScript.Shell
$sawInteractiveWindow = $false
$completed = $false
$deadline = (Get-Date).AddMinutes(4)
try {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $texts = [InstallerWindows]::InstallerTexts()
    if ($texts.Count) { $sawInteractiveWindow = $true }
    $all = $texts -join "`n"
    if ($all -match '无法关闭|重试\(' -or $all -match 'Failed to uninstall old application files') {
      throw "Detected forbidden retry/close dialog:`n$all"
    }
    # NSIS marks Next / Install / Finish as the default action on each page.
    # Activating the real visible window and pressing Enter exercises the same
    # interactive path as a user instead of invoking the installer silently.
    if (!$OneClick -and $texts.Count -and $keyboard.AppActivate($process.Id)) {
      $keyboard.SendKeys('{ENTER}')
      Start-Sleep -Milliseconds 250
    }
    if (!$OneClick) {
      foreach ($label in @('完成', '安装', '下一步', '我接受')) {
        if ([InstallerWindows]::ClickButton($label)) { break }
      }
    }
    $process.Refresh()
    if ($process.HasExited) { $completed = $true; break }
  }
} finally {
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Get-Process | Where-Object { $_.ProcessName -eq '文档批量处理工具' } | Stop-Process -Force -ErrorAction SilentlyContinue
}
if (!$sawInteractiveWindow) { throw 'Interactive installer window was never observed.' }
if (!$completed -or $process.ExitCode -ne 0) { throw "Interactive installer did not complete successfully (exit=$($process.ExitCode))." }
if (!(Test-Path $appExe)) { throw 'Installed application executable is missing.' }
$version = (Get-Item $appExe).VersionInfo.ProductVersion
if (!$version.StartsWith($ExpectedVersion)) { throw "Installed version mismatch: $version" }
Write-Output "PASS installer-upgrade mode=$(if($OneClick){'one-click'}else{'assisted'}) version=$version no-retry-dialog"
