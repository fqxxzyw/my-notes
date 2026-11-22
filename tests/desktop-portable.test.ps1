$ErrorActionPreference = 'Stop'
$sdk = Join-Path $PSScriptRoot '..\desktop\.cache\webview2-1.0.4370.26\lib\net462'
$source = Join-Path $PSScriptRoot '..\desktop\PaperNotes.cs'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$caseRoot = Join-Path $env:TEMP ('paper-notes-portable-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($caseRoot)
$compiled = Join-Path $caseRoot 'portable-test.dll'
& $compiler /nologo /target:library /platform:x64 /codepage:65001 ("/out:$compiled") `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Security.dll `
  /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
  ("/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')") ("/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')") $source
if ($LASTEXITCODE -ne 0) { throw 'Desktop test compilation failed.' }
[void][Reflection.Assembly]::LoadFrom((Resolve-Path (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')).Path)
[void][Reflection.Assembly]::LoadFrom((Resolve-Path (Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')).Path)
$type = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($compiled)).GetType('PaperNotesDesktop.Program', $true)
$flags = [Reflection.BindingFlags]'Static,NonPublic'
$resolve = $type.GetMethod('ResolveDataDirectory', $flags)
$ensure = $type.GetMethod('EnsurePortableDataDirectory', $flags)
$exeDir = Join-Path $caseRoot 'unpacked'
$normalRoot = Join-Path $caseRoot 'local-app-data'
[void][IO.Directory]::CreateDirectory($exeDir)
$exePath = Join-Path $exeDir 'paper.exe'
[IO.File]::WriteAllText($exePath, 'test')
[object[]]$argsForResolve = @([string]$exePath, [string]$normalRoot, $false)
$normal = $resolve.Invoke($null, $argsForResolve)
if ($normal -ne (Join-Path $normalRoot 'PaperNotes') -or $argsForResolve[2]) { throw 'Normal mode changed its existing location.' }
$marker = Join-Path $exeDir 'portable.mode'
[IO.File]::WriteAllText($marker, '')
[object[]]$argsForResolve = @([string]$exePath, [string]$normalRoot, $false)
$portable = $resolve.Invoke($null, $argsForResolve)
$dataName = -join [char[]]@(0x7eb8, 0x95f4, 0x6570, 0x636e)
$expectedPortable = [IO.Path]::GetFullPath((Join-Path $exeDir $dataName))
if ($portable -ne $expectedPortable -or !$argsForResolve[2]) { throw 'Portable mode did not use the executable directory.' }
[void]$ensure.Invoke($null, [object[]]@([string]$portable))
if (!(Test-Path -LiteralPath $portable -PathType Container)) { throw 'Portable directory was not created.' }
$blocker = Join-Path $caseRoot 'not-a-directory'
[IO.File]::WriteAllText($blocker, 'test')
$rejected = $false
try { [void]$ensure.Invoke($null, [object[]]@([string](Join-Path $blocker 'data'))) } catch {
  $rejected = $_.Exception.InnerException -is [InvalidOperationException]
}
if (!$rejected) { throw 'An unwritable portable location did not produce a clear error.' }
[IO.File]::Delete($marker)
[IO.File]::Delete($exePath)
[IO.File]::Delete($blocker)
[IO.File]::Delete($compiled)
[IO.Directory]::Delete($portable)
[IO.Directory]::Delete($exeDir)
[IO.Directory]::Delete($caseRoot)
Write-Output 'Desktop portable and normal data paths passed.'
