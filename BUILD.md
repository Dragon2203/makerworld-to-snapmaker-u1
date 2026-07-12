# Building MakerWorld to Snapmaker U1

This document describes how to reproduce the browser extension packages submitted to Mozilla Add-ons and published through GitHub Releases.

## Build Environment

The release packages are built on:

* Windows 10 or Windows 11
* Windows PowerShell 5.1 or newer
* Microsoft .NET components included with Windows:

  * `System.IO.Compression`
  * `System.IO.Compression.FileSystem`

No additional development tools or package managers are required.

The build does not use:

* Node.js
* npm
* Webpack
* TypeScript
* Babel
* code generators
* source-code transpilers
* project-specific minification

## Third-Party Library

The extension includes:

* JSZip 3.10.1
* File: `lib/jszip.min.js`
* Official project: `https://github.com/Stuk/jszip`
* License: MIT or GPLv3

`lib/jszip.min.js` is the unmodified official browser distribution supplied by the JSZip project. It is not generated or modified by this repository's build script.

All project-specific JavaScript files are included in the repository in their original, readable and unminified form.

## Source Files

The repository contains two browser manifests:

* `manifest.json` for Chrome and Chromium-based browsers
* `manifest.firefox.json` for Mozilla Firefox

All other runtime source files are shared between both browser packages.

## Build Instructions

1. Extract the submitted source archive or clone the repository.
2. Open Windows PowerShell in the project root directory.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

No dependencies need to be installed before running this command.

## Build Output

The build script first checks that `manifest.json` and `manifest.firefox.json` contain the same extension version.

It then recreates the `dist` directory and generates:

```text
dist/
├── chrome/
├── firefox/
├── source/
├── makerworld-to-snapmaker-u1-chrome-v<version>.zip
├── makerworld-to-snapmaker-u1-firefox-v<version>.zip
└── makerworld-to-snapmaker-u1-source-v<version>.zip
```

The Firefox package submitted to Mozilla Add-ons is:

```text
dist/makerworld-to-snapmaker-u1-firefox-v<version>.zip
```

For version 1.1.0, the exact file is:

```text
dist/makerworld-to-snapmaker-u1-firefox-v1.1.0.zip
```

The Firefox output contains the contents of `manifest.firefox.json` under the required filename `manifest.json`.

The ZIP archives are generated with forward-slash path separators so that their internal file names comply with Mozilla Add-ons packaging requirements.

## Reproducing the Submitted Add-on

To reproduce the submitted Firefox add-on exactly:

1. Use the source files associated with version 1.1.0.
2. Confirm that both manifests contain version `1.1.0`.
3. Run the build command shown above.
4. Use the generated file:

```text
dist/makerworld-to-snapmaker-u1-firefox-v1.1.0.zip
```

No project source files are transformed, transpiled or minified during this process. The build script only selects the required runtime files, applies the browser-specific manifest filename and creates the release archive.
