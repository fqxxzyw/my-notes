$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$sdk = Join-Path $PSScriptRoot '..\desktop\.cache\webview2-1.0.4370.26\lib\net462'
$source = Join-Path $PSScriptRoot '..\desktop\PaperNotes.cs'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$compiled = Join-Path $env:TEMP 'paper-notes-credential-check.dll'
& $compiler /nologo /target:library /platform:x64 /codepage:65001 ("/out:$compiled") `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Security.dll `
  /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
  ("/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')") ("/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')") $source
if ($LASTEXITCODE -ne 0) { throw 'Desktop test compilation failed.' }
[void][Reflection.Assembly]::LoadFrom((Resolve-Path (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')).Path)
[void][Reflection.Assembly]::LoadFrom((Resolve-Path (Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')).Path)
$assembly = [Reflection.Assembly]::LoadFrom($compiled)
$type = $assembly.GetType('PaperNotesDesktop.MainWindow', $true)
$instance = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($type)
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$caseRoot = Join-Path $env:TEMP ('paper-notes-credential-test-' + [guid]::NewGuid().ToString('N'))
$credentials = Join-Path $caseRoot 'Credentials'
$type.GetField('credentialDirectory', $flags).SetValue($instance, $credentials)
$type.GetField('profile', $flags).SetValue($instance, (Join-Path $caseRoot 'WebView2'))
$path = $type.GetMethod('GetCredentialPath', $flags)
$alice = $path.Invoke($instance, @('Alice/Notes'))
$aliceLower = $path.Invoke($instance, @('alice/notes'))
$bob = $path.Invoke($instance, @('Bob/Notes'))
if ($alice -ne $aliceLower -or $alice -eq $bob -or (Split-Path -Leaf $alice) -notmatch '^[a-f0-9]{64}\.dat$') { throw 'Credential paths are not isolated.' }
foreach ($invalid in @('https://evil.test/x/y', '../secrets', 'alice/../../secrets', 'alice/notes?token=x')) {
  $rejected = $false
  try { [void]$path.Invoke($instance, @($invalid)) } catch { $rejected = $true }
  if (!$rejected) { throw 'Accepted an invalid repository.' }
}
if ((Split-Path -Leaf $alice) -eq 'github-token.dat') { throw 'Legacy token path was reused.' }
[void][IO.Directory]::CreateDirectory($caseRoot)
$legacyPath = Join-Path $caseRoot 'github-token.dat'
$fakeToken = [Text.Encoding]::UTF8.GetBytes('fake-token-for-isolated-test')
$legacyBytes = [Security.Cryptography.ProtectedData]::Protect($fakeToken, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes($legacyPath, $legacyBytes)
$import = $type.GetMethod('ImportLegacyCredential', $flags)
[void]$import.Invoke($instance, @($alice))
$recovered = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($alice), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
if ([Text.Encoding]::UTF8.GetString($recovered) -ne 'fake-token-for-isolated-test') { throw 'Legacy import did not preserve token.' }
if (![IO.File]::Exists($legacyPath) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyPath)) -ne [Convert]::ToBase64String($legacyBytes)) { throw 'Legacy file changed.' }
if ([IO.File]::Exists($bob)) { throw 'Legacy import leaked into another repository.' }
$againRejected = $false
try { [void]$import.Invoke($instance, @($alice)) } catch { $againRejected = $true }
if (!$againRejected) { throw 'Legacy import overwrote an existing credential.' }
Write-Output 'Desktop credential path isolation and explicit legacy import passed.'
