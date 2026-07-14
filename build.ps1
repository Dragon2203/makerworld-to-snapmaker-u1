$ErrorActionPreference = 'Stop'

$rootDir = $PSScriptRoot
$distDir = Join-Path $rootDir 'dist'
$chromeDir = Join-Path $distDir 'chrome'
$firefoxDir = Join-Path $distDir 'firefox'
$sourceDir = Join-Path $distDir 'source'

$chromeManifestPath = Join-Path $rootDir 'manifest.json'
$firefoxManifestPath = Join-Path $rootDir 'manifest.firefox.json'

if (-not (Test-Path $chromeManifestPath)) {
    throw 'manifest.json was not found.'
}

if (-not (Test-Path $firefoxManifestPath)) {
    throw 'manifest.firefox.json was not found.'
}

$chromeManifest = Get-Content $chromeManifestPath -Raw | ConvertFrom-Json
$firefoxManifest = Get-Content $firefoxManifestPath -Raw | ConvertFrom-Json

if ($chromeManifest.version -ne $firefoxManifest.version) {
    throw "Manifest versions do not match: Chrome $($chromeManifest.version), Firefox $($firefoxManifest.version)"
}

$version = $chromeManifest.version

Write-Host "Building MakerWorld to Snapmaker U1 v$version..."

# Always recreate dist from scratch so no obsolete files survive.
if (Test-Path $distDir) {
    Remove-Item $distDir -Recurse -Force
}

New-Item $chromeDir -ItemType Directory -Force | Out-Null
New-Item $firefoxDir -ItemType Directory -Force | Out-Null
New-Item $sourceDir -ItemType Directory -Force | Out-Null

# Files shared by the generated Chrome and Firefox packages.
$sharedFiles = @(
    'background.js',
    'content.js',
    'converter.js',
    'injected.js',
    'options.html',
    'options.js',

    'u1_3mf_metadata.js',
    'u1_bambu_parser.js',
    'u1_compatibility.js',
    'u1_custom_printer_profiles.js',
    'u1_filament_merge.js',
    'u1_model_parser.js',
    'u1_profile_resolver.js',
    'u1_project_builder.js',
    'u1_project_merge.js',
    'u1_project_parser.js',
    'u1_project_report.js',

    'README.md',
    'CHANGELOG.md',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'LICENSE',
    'LICENSE-POLYFORM'
)

$sharedDirectories = @(
    'assets',
    'lib'
)

foreach ($file in $sharedFiles) {
    $sourcePath = Join-Path $rootDir $file

    if (-not (Test-Path $sourcePath)) {
        throw "Required runtime file is missing: $file"
    }

    Copy-Item $sourcePath $chromeDir
    Copy-Item $sourcePath $firefoxDir
}

foreach ($directory in $sharedDirectories) {
    $sourcePath = Join-Path $rootDir $directory

    if (-not (Test-Path $sourcePath)) {
        throw "Required runtime directory is missing: $directory"
    }

    Copy-Item $sourcePath $chromeDir -Recurse
    Copy-Item $sourcePath $firefoxDir -Recurse
}

# Chrome keeps the normal repository manifest.
Copy-Item $chromeManifestPath (Join-Path $chromeDir 'manifest.json')

# Firefox receives its dedicated manifest under the required filename.
Copy-Item $firefoxManifestPath (Join-Path $firefoxDir 'manifest.json')

# Source archive submitted to Mozilla Add-ons reviewers.
# It contains the readable project sources, build instructions and the
# unmodified third-party library used by the packaged extension.
$sourceFiles = @(
    'manifest.json',
    'manifest.firefox.json',

    'background.js',
    'content.js',
    'converter.js',
    'injected.js',
    'options.html',
    'options.js',

    'u1_3mf_metadata.js',
    'u1_bambu_parser.js',
    'u1_compatibility.js',
    'u1_custom_printer_profiles.js',
    'u1_filament_merge.js',
    'u1_model_parser.js',
    'u1_profile_resolver.js',
    'u1_project_builder.js',
    'u1_project_merge.js',
    'u1_project_parser.js',
    'u1_project_report.js',

    'build.ps1',
    'BUILD.md',
    'README.md',
    'CHANGELOG.md',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'LICENSE',
    'LICENSE-POLYFORM'
)

$sourceDirectories = @(
    'assets',
    'lib'
)

foreach ($file in $sourceFiles) {
    $sourcePath = Join-Path $rootDir $file

    if (-not (Test-Path $sourcePath)) {
        throw "Required source file is missing: $file"
    }

    Copy-Item $sourcePath $sourceDir
}

foreach ($directory in $sourceDirectories) {
    $sourcePath = Join-Path $rootDir $directory

    if (-not (Test-Path $sourcePath)) {
        throw "Required source directory is missing: $directory"
    }

    Copy-Item $sourcePath $sourceDir -Recurse
}

$chromeZip = Join-Path $distDir "makerworld-to-snapmaker-u1-chrome-v$version.zip"
$firefoxZip = Join-Path $distDir "makerworld-to-snapmaker-u1-firefox-v$version.zip"
$sourceZip = Join-Path $distDir "makerworld-to-snapmaker-u1-source-v$version.zip"

# Create standards-compliant ZIP archives with forward slashes in entry names.
# PowerShell's Compress-Archive may store Windows backslashes, which AMO rejects.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-PortableZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    if (Test-Path $DestinationPath) {
        Remove-Item $DestinationPath -Force
    }

    $sourceRoot = (Resolve-Path $SourceDirectory).Path.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )

    $archiveStream = [System.IO.File]::Open(
        $DestinationPath,
        [System.IO.FileMode]::Create
    )

    try {
        $archive = New-Object System.IO.Compression.ZipArchive(
            $archiveStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )

        try {
            Get-ChildItem $sourceRoot -File -Recurse | ForEach-Object {
                $relativePath = $_.FullName.Substring($sourceRoot.Length + 1)
                $entryName = $relativePath.Replace('\', '/')

                $entry = $archive.CreateEntry(
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                )

                $entryStream = $entry.Open()
                $fileStream = [System.IO.File]::OpenRead($_.FullName)

                try {
                    $fileStream.CopyTo($entryStream)
                }
                finally {
                    $fileStream.Dispose()
                    $entryStream.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $archiveStream.Dispose()
    }
}

New-PortableZip `
    -SourceDirectory $chromeDir `
    -DestinationPath $chromeZip

New-PortableZip `
    -SourceDirectory $firefoxDir `
    -DestinationPath $firefoxZip

# --------------------------------------------------------------------------
# Create Mozilla source archive (without wrapping everything in /source)
# --------------------------------------------------------------------------

if (Test-Path $sourceZip) {
    Remove-Item $sourceZip -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open(
    $sourceZip,
    [System.IO.Compression.ZipArchiveMode]::Create
)

try {

    Get-ChildItem $sourceDir -Recurse | ForEach-Object {

        if ($_.PSIsContainer) {
            return
        }

        $relative = $_.FullName.Substring($sourceDir.Length + 1) -replace '\\','/'

        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $_.FullName,
            $relative,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }

}
finally {
    $zip.Dispose()
}

Write-Host ''
Write-Host 'Build completed successfully.'
Write-Host "Chrome folder:  $chromeDir"
Write-Host "Firefox folder: $firefoxDir"
Write-Host "Source folder:  $sourceDir"
Write-Host "Chrome ZIP:     $chromeZip"
Write-Host "Firefox ZIP:    $firefoxZip"
Write-Host "Source ZIP:     $sourceZip"