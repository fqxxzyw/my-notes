[CmdletBinding()]
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot '..\release'
}
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cacheRoot = Join-Path $PSScriptRoot '.cache'
$packagePath = Join-Path $cacheRoot 'webview2-1.0.4370.26.nupkg'
$sdkRoot = Join-Path $cacheRoot 'webview2-1.0.4370.26'
$expectedSha512 = 'EB2FAF9A00433FFD5879266242DF494528F7C397DF7622FFBAEFD2C08437852832BEA727446BA784EBF01861B958EAC3A75E741BA30FF098D11BC02D5B9159E7'
$packageUrl = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4370.26/microsoft.web.webview2.1.0.4370.26.nupkg'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (!(Test-Path -LiteralPath $csc)) { throw 'Windows .NET Framework C# compiler was not found.' }
if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'app.ico'))) { throw 'desktop/app.ico is required.' }
[void][IO.Directory]::CreateDirectory($cacheRoot)
if (!(Test-Path -LiteralPath $packagePath)) {
    Write-Host 'Downloading the official Microsoft WebView2 SDK...'
    $downloadPath = Join-Path $cacheRoot ('download-' + [guid]::NewGuid().ToString('N') + '.nupkg')
    try {
        Invoke-WebRequest -Uri $packageUrl -OutFile $downloadPath
        if ((Get-FileHash -Algorithm SHA512 -LiteralPath $downloadPath).Hash -ne $expectedSha512) {
            throw 'WebView2 package SHA-512 does not match the pinned value.'
        }
        Move-Item -LiteralPath $downloadPath -Destination $packagePath
    } finally {
        if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
    }
}
if ((Get-FileHash -Algorithm SHA512 -LiteralPath $packagePath).Hash -ne $expectedSha512) {
    throw 'Cached WebView2 package SHA-512 does not match the pinned value.'
}

if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'))) {
    [void][IO.Directory]::CreateDirectory($sdkRoot)
    & tar -xf $packagePath -C $sdkRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to unpack the WebView2 SDK.' }
}

Push-Location $projectRoot
try {
    & npm run docs:build
    if ($LASTEXITCODE -ne 0) { throw 'The VitePress build failed.' }
} finally { Pop-Location }

$stage = Join-Path $cacheRoot ('stage-' + [guid]::NewGuid().ToString('N'))
$absoluteStage = [IO.Path]::GetFullPath($stage)
$absoluteCache = [IO.Path]::GetFullPath($cacheRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (!$absoluteStage.StartsWith($absoluteCache, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path.' }
try {
    $sitePath = Join-Path $stage 'payload\site\my-notes'
    [void][IO.Directory]::CreateDirectory($sitePath)
    Copy-Item -Path (Join-Path $projectRoot 'docs\.vitepress\dist\*') -Destination $sitePath -Recurse
    $payloadRoot = Join-Path $stage 'payload'
    foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
        Copy-Item -LiteralPath (Join-Path $sdkRoot ('lib\net462\' + $name)) -Destination $payloadRoot
    }
    Copy-Item -LiteralPath (Join-Path $sdkRoot 'build\native\x64\WebView2Loader.dll') -Destination $payloadRoot
    $payloadZip = Join-Path $stage 'payload.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $payloadZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    [void][IO.Directory]::CreateDirectory($OutputDirectory)
    $outputPath = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) '纸间.exe'

    $references = @(
        (Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'),
        (Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.dll'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.FileSystem.dll')
    )
    $args = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', '/codepage:65001',
        ('/out:' + $outputPath), ('/win32icon:' + (Join-Path $PSScriptRoot 'app.ico')),
        ('/win32manifest:' + (Join-Path $PSScriptRoot 'app.manifest')),
        ('/resource:' + $payloadZip + ',PaperNotes.Payload'),
        '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
        '/reference:System.Security.dll', '/reference:System.Web.Extensions.dll')
    foreach ($reference in $references) { $args += '/reference:' + $reference }
    $args += (Join-Path $PSScriptRoot 'PaperNotes.cs')
    & $csc $args
    if ($LASTEXITCODE -ne 0) { throw 'The desktop compiler failed.' }
    Write-Host "Built $outputPath"
} finally {
    if (Test-Path -LiteralPath $absoluteStage) { Remove-Item -LiteralPath $absoluteStage -Recurse -Force }
}
