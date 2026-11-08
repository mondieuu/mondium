# CI only: uses the real installer and uninstaller screens the way a person would, and photographs each one.
# Usage: tools/installer-test.ps1 <Mondium-Setup.exe> <folder for pictures> [older Mondium-Setup.exe]
# It installs, removes and closes Mondium and deletes its data, so it must never run on someone's own computer.
param([string]$Setup, [string]$Shots, [string]$Older = '')
if (-not $env:CI) { Write-Error 'This test replaces the installed Mondium. It only runs in CI.'; exit 2 }
$ErrorActionPreference = 'Stop'
$Shots = (New-Item -ItemType Directory -Force $Shots).FullName

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class Ui {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32")] public static extern bool SetProcessDPIAware();
  [DllImport("user32")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct R { public int l,t,r,b; }
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32")] static extern bool PrintWindow(IntPtr h, IntPtr dc, int f);
  [DllImport("user32")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32")] static extern bool PostMessageW(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32")] static extern IntPtr SendMessageW(IntPtr h, int m, IntPtr w, IntPtr l);

  static string Text(IntPtr h) { var s = new StringBuilder(256); GetWindowTextW(h, s, 256); return s.ToString(); }
  static string Class(IntPtr h) { var s = new StringBuilder(64); GetClassNameW(h, s, 64); return s.ToString(); }

  // The Mondium window: a visible dialog titled Mondium
  public static IntPtr Find() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (IsWindowVisible(h) && Class(h) == "#32770" && Text(h).StartsWith("Mondium")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  // Everything a person can read in it, visible controls only
  public static string Read(IntPtr win) {
    var parts = new List<string>();
    EnumChildWindows(win, (h, l) => {
      var c = Class(h);
      if (IsWindowVisible(h) && (c == "Static" || c == "Button")) { var t = Text(h); if (t.Trim() != "") parts.Add(t); }
      return true;
    }, IntPtr.Zero);
    return string.Join(" | ", parts);
  }
  public static void Click(IntPtr button) { PostMessageW(button, 0x00F5, IntPtr.Zero, IntPtr.Zero); }
  public static void ClickNext(IntPtr win) { Click(GetDlgItem(win, 1)); }
  public static bool NextReady(IntPtr win) { IntPtr b = GetDlgItem(win, 1); return IsWindowVisible(b) && IsWindowEnabled(b); }
  public static bool CheckBox(IntPtr win) {
    bool done = false;
    EnumChildWindows(win, (h, l) => {
      // BS_AUTOCHECKBOX is the only Button of that style here
      if (!done && Class(h) == "Button" && IsWindowVisible(h) && (GetWindowLong(h, -16).ToInt64() & 0xF) == 3) {
        SendMessageW(h, 0x00F1, new IntPtr(1), IntPtr.Zero); done = true;
      }
      return true;
    }, IntPtr.Zero);
    return done;
  }
  [DllImport("user32", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLong(IntPtr h, int i);
  public static void Photo(IntPtr win, string file) {
    R r; GetWindowRect(win, out r);
    using (var bmp = new Bitmap(r.r - r.l, r.b - r.t)) {
      using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow(win, dc, 2); g.ReleaseHdc(dc); }
      bmp.Save(file, ImageFormat.Png);
    }
  }
}
'@
[void][Ui]::SetProcessDPIAware()

$script:failures = 0
function Report($ok, [string]$name, [string]$detail = '') {
  $ok = [bool]$ok
  if (-not $ok) { $script:failures++ }
  Write-Host ("{0}  {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { ": $detail" } else { '' }))
}
function Until([scriptblock]$check, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { $v = & $check; if ($v) { return $v }; Start-Sleep -Milliseconds 100 }
  return $null
}

$dir = "$env:LOCALAPPDATA\Programs\Mondium"
$exe = "$dir\Mondium.exe"
$uninstaller = "$dir\Uninstall Mondium.exe"
$data = "$env:APPDATA\Mondium"
$marker = "$data\marker-from-test.txt"
$desktop = [Environment]::GetFolderPath('Desktop') + '\Mondium.lnk'
$startMenu = [Environment]::GetFolderPath('Programs') + '\Mondium.lnk'
$browserKey = 'HKCU:\Software\Clients\StartMenuInternet\Mondium'

function Close-Mondium {
  Get-Process Mondium -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Until { -not (Get-Process Mondium -ErrorAction SilentlyContinue) } 20 | Out-Null
  Start-Sleep -Milliseconds 500
}
function Seed-Data { New-Item -ItemType Directory -Force $data | Out-Null; Set-Content $marker 'keep me' }
# Not -Wait: that also waits for the browser the installer starts
function Silent([string]$file, [string[]]$arguments) {
  $p = Start-Process $file -ArgumentList $arguments -PassThru
  [void]$p.Handle
  [void]$p.WaitForExit(300000)
  $p.ExitCode
}
function Check-Installed([string]$when) {
  Report (Test-Path $exe) "$when`: Mondium.exe is there"
  Report (Test-Path $uninstaller) "$when`: the uninstaller is there"
  Report (Test-Path $desktop) "$when`: desktop shortcut"
  Report (Test-Path $startMenu) "$when`: Start menu shortcut"
  Report (Test-Path $browserKey) "$when`: listed as a browser in Windows"
}
function Check-Removed([string]$when) {
  Report (Until { -not (Test-Path $exe) } 30) "$when`: Mondium.exe is gone"
  Report (-not (Test-Path $desktop)) "$when`: desktop shortcut is gone"
  Report (-not (Test-Path $startMenu)) "$when`: Start menu shortcut is gone"
  Report (-not (Test-Path $browserKey)) "$when`: no longer listed as a browser"
}
function Wait-Removed-Process { Until { -not (Get-Process | Where-Object { $_.ProcessName -match '^(Un_|Uninstall)' }) } 60 | Out-Null }

# 1. A first install, by hand
Start-Process $Setup
$win = Until { $w = [Ui]::Find(); if ($w -ne [IntPtr]::Zero) { $w } } 60
Report ($null -ne $win) 'the installer window opens'
if ($win) {
  Start-Sleep -Milliseconds 800
  $text = [Ui]::Read($win)
  Report ($text -match 'ready to install|kurulmaya haz') 'first screen says it is ready' $text
  Report ($text -notmatch 'Nullsoft|who should|kimin') 'nothing else is asked' $text
  [Ui]::Photo($win, "$Shots\1-install.png")
  [Ui]::ClickNext($win)
  $seen = Until { $t = [Ui]::Read($win); if ($t -match 'Installing|Kuruluyor') { $t } } 30
  Report ([bool]$seen) 'shows that it is installing' $seen
  Start-Sleep -Milliseconds 700
  try { [Ui]::Photo($win, "$Shots\2-installing.png") } catch {}
  Report (Until { Get-Process Mondium -ErrorAction SilentlyContinue } 180) 'Mondium opens by itself when done'
  Report (Until { [Ui]::Find() -eq [IntPtr]::Zero } 30) 'the installer window goes away'
  Check-Installed 'by hand'
  Start-Sleep -Seconds 3
  Close-Mondium
}

# 2. The update path: silent, no screens, data untouched, and Mondium comes back
Seed-Data
$code = Silent $Setup @('/S', '--force-run', '--updated')
Report ($code -eq 0) 'silent update exits cleanly' "exit code $code"
Report (Until { Get-Process Mondium -ErrorAction SilentlyContinue } 60) 'Mondium opens again after a silent update'
Report (Test-Path $marker) 'silent update keeps the data'
Check-Installed 'silent update'
Close-Mondium

# 3. The second time the installer says update
Start-Process $Setup
$win = Until { $w = [Ui]::Find(); if ($w -ne [IntPtr]::Zero) { $w } } 60
if ($win) {
  Start-Sleep -Milliseconds 800
  $text = [Ui]::Read($win)
  Report ($text -match 'will be updated|g.ncellenecek') 'over an install it offers to update' $text
  [Ui]::Photo($win, "$Shots\3-update.png")
  [Ui]::Click([Ui]::GetDlgItem($win, 2))
  Report (Until { [Ui]::Find() -eq [IntPtr]::Zero } 15) 'Cancel closes it and changes nothing'
  Report (Test-Path $exe) 'still installed after Cancel'
}

# 4. Removing by hand with the box off keeps the data
Seed-Data
Start-Process $uninstaller
$win = Until { $w = [Ui]::Find(); if ($w -ne [IntPtr]::Zero) { $w } } 30
Report ($null -ne $win) 'the uninstaller window opens'
if ($win) {
  Start-Sleep -Milliseconds 800
  $text = [Ui]::Read($win)
  Report ($text -match 'Remove Mondium|kald.r.lacak') 'first screen says what it will do' $text
  [Ui]::Photo($win, "$Shots\4-uninstall.png")
  [Ui]::ClickNext($win)
  $done = Until { $t = [Ui]::Read($win); if ($t -match 'was removed|kald.r.ld.') { $t } } 90
  Report ([bool]$done) 'says when it is done' $done
  Report ($done -match 'still here|duruyor') 'says the data is kept' $done
  Start-Sleep -Milliseconds 500
  [Ui]::Photo($win, "$Shots\5-uninstalled-kept.png")
  [Ui]::ClickNext($win)
  Report (Until { [Ui]::Find() -eq [IntPtr]::Zero } 15) 'Close closes it'
}
Wait-Removed-Process
Check-Removed 'by hand'
Report (Test-Path $marker) 'removing with the box off keeps the data'

# 5. A silent removal never touches the data
$code = Silent $Setup @('/S')
Report ($code -eq 0) 'silent install exits cleanly' "exit code $code"
Check-Installed 'silent install'
Close-Mondium
Seed-Data
$code = Silent $uninstaller @('/S')
Wait-Removed-Process
Check-Removed 'silent'
Report (Test-Path $marker) 'a silent removal keeps the data'

# 6. Removing by hand with the box on deletes the data
Silent $Setup @('/S') | Out-Null
Close-Mondium
Seed-Data
Start-Process $uninstaller
$win = Until { $w = [Ui]::Find(); if ($w -ne [IntPtr]::Zero) { $w } } 30
if ($win) {
  Start-Sleep -Milliseconds 800
  Report ([Ui]::CheckBox($win)) 'the data box can be ticked'
  [Ui]::ClickNext($win)
  $done = Until { $t = [Ui]::Read($win); if ($t -match 'was removed|kald.r.ld.') { $t } } 90
  Report ($done -match 'deleted too|silindi') 'says the data was deleted' $done
  Start-Sleep -Milliseconds 500
  [Ui]::Photo($win, "$Shots\6-uninstalled-deleted.png")
  [Ui]::ClickNext($win)
}
Wait-Removed-Process
Check-Removed 'with data'
Report (-not (Test-Path $data)) 'removing with the box on deletes the data'

# 7. The way users arrive here: the previous release, then this one on top of it, as the updater runs it
if ($Older) {
  Silent $Older @('/S') | Out-Null
  Close-Mondium
  Seed-Data
  $code = Silent $Setup @('/S', '--force-run', '--updated')
  Report ($code -eq 0) 'update from the published release exits cleanly' "exit code $code"
  Report (Until { Get-Process Mondium -ErrorAction SilentlyContinue } 60) 'Mondium opens after updating from the published release'
  Report (Test-Path $marker) 'updating from the published release keeps the data'
  Check-Installed 'from the published release'
  Close-Mondium
  Silent $uninstaller @('/S') | Out-Null
  Wait-Removed-Process
  Check-Removed 'after the update'
}
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue

if ($script:failures) { Write-Host "$($script:failures) check(s) failed."; exit 1 }
Write-Host 'All checks passed.'
exit 0
