param(
    [switch]$SkipTests,
    [switch]$SkipEditorBundle
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$androidDir = $PSScriptRoot
$releaseDir = Join-Path $root 'release'

if (-not $SkipEditorBundle) {
    $esbuild = Join-Path $root 'node_modules\.bin\esbuild.cmd'
    if (-not (Test-Path $esbuild)) {
        throw "未找到 node_modules\.bin\esbuild.cmd，请先在项目根目录运行 npm ci。"
    }
    Write-Host '[1/3] 打包离线 CodeMirror 6 编辑器资产...'
    $entry = Join-Path $androidDir 'editor-web\src\main.ts'
    $outBundle = Join-Path $androidDir 'app\src\main\assets\editor\editor.bundle.js'
    & $esbuild $entry --bundle --format=iife --target=es2020 --minify "--outfile=$outBundle"
    if ($LASTEXITCODE -ne 0) { throw '编辑器资产打包失败。' }
}

$needsJbr = (-not $env:JAVA_HOME) -or ($env:JAVA_HOME -match 'jdk-25|jdk-24')
if ($needsJbr) {
    $jbrCandidates = @(
        'D:\Android studio1\jbr',
        'D:\Android Studio\jbr',
        'C:\Program Files\Android\Android Studio\jbr'
    )
    foreach ($candidate in $jbrCandidates) {
        if (Test-Path (Join-Path $candidate 'bin\java.exe')) {
            $env:JAVA_HOME = $candidate
            break
        }
    }
}
if (-not $env:ANDROID_HOME) {
    if (Test-Path 'D:\SDK\Sdk') { $env:ANDROID_HOME = 'D:\SDK\Sdk' }
    elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
}
if (-not $env:GRADLE_USER_HOME -and (Test-Path 'D:\Android Studio\gradle')) {
    $env:GRADLE_USER_HOME = 'D:\Android Studio\gradle'
}

Push-Location $androidDir
try {
    if (-not $SkipTests) {
        Write-Host '[2/3] 运行隔离单元测试...'
        .\gradlew.bat testDebugUnitTest --no-daemon
        if ($LASTEXITCODE -ne 0) { throw '单元测试未通过。' }
    }

    Write-Host '[3/3] 构建 Release APK...'
    .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Release APK 构建失败。' }
} finally {
    Pop-Location
}

$apkSource = Join-Path $androidDir 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apkSource)) { throw "未找到生成的 APK：$apkSource" }
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$apkTarget = Join-Path $releaseDir 'paper-notes-android.apk'
Copy-Item -Force $apkSource $apkTarget
Write-Host "构建完成：$apkTarget"
