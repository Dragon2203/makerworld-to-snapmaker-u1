# Download regression checks

The dependency-free transport tests use Node.js 18 or newer (Node is not required to build or run the extension):

```sh
node --test tests/downloads.test.cjs
```

They execute the output-download sections of `content.js` with browser API stubs, covering the opt-in native link, default Chromium messaging, Firefox binary messages, filename normalization and error reporting. Browser-level filename arbitration must also be checked in Chromium.

## Manual integration check

1. Load the unpacked extension and keep Free Download Manager enabled. Enable **Force converted download filename** in the U1 settings.
2. Convert a MakerWorld profile with a Chinese filename. Check that the browser saves the expected `-U1.3mf` name and the ZIP archive passes an integrity check.
3. Convert the same profile again. Check that the browser adds its usual duplicate-name suffix instead of overwriting the first file.
4. Convert a second model. Check that each conversion creates one output download and that Free Download Manager has no new filename-conflict warning in the extensions page.
5. Check an ordinary browser download. It should continue to follow the user's existing FDM settings.

Use the normal browser download flow for these checks. Download interception in automation tools can override the browser's filename handling and hide this regression. The native path reports initiation of the save, not completion on disk; verify completion in the browser download list.
