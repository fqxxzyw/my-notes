$ErrorActionPreference = 'Stop'
$cache = [IO.Path]::GetFullPath('desktop\.cache').TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$scratch = [IO.Path]::GetFullPath((Join-Path $cache ('attachment-test-' + [guid]::NewGuid().ToString('N'))))
if (!$scratch.StartsWith($cache, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test path' }
[void][IO.Directory]::CreateDirectory($scratch)
try {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $sdk = [IO.Path]::GetFullPath('desktop\.cache\webview2-1.0.4370.26\lib\net462')
  $library = Join-Path $scratch 'host-test.exe'
  $compilerArgs = @('/nologo','/target:exe','/main:DesktopAttachmentHarness','/platform:x64','/codepage:65001',('/out:' + $library),'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Security.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',('/reference:' + (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')),('/reference:' + (Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')),'desktop\PaperNotes.cs','tests\desktop-attachment-harness.cs')
  & $csc $compilerArgs
  if ($LASTEXITCODE -ne 0) { throw 'Native host compilation failed' }
  & $library $scratch
  if ($LASTEXITCODE -ne 0) { throw 'Desktop attachment harness failed' }
} finally {
  if ($scratch.StartsWith($cache, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $scratch)) {
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
}
