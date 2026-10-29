# Download regression checks

Run the dependency-free tests with Node.js 18 or newer (not required to build or run the extension):

```sh
node --test tests/*.test.cjs
```

The tests execute production settings, the shared output workflow through both MakerWorld and local entry points, background handlers and report formatters with browser API stubs. Coverage includes all three methods, default/legacy migration and explicit precedence, settings save/hints, Firefox binary transport, filename normalization and retry failures, messaging errors, retained error code `U1-DL-005`, diagnostic methods/status, forced-state storage fallback, filename listener cleanup, and package script wiring.

## Manual integration check

1. Load the unpacked extension with a legacy `forceDownloadFilename: true` setting and no saved method. Confirm **Force filename (Chrome API)** remains selected. A false/missing legacy setting should select **Standard**.
2. Keep Free Download Manager enabled and explicitly select **Native HTML download**. Save and reload the options page to verify persistence and the selected-method explanation.
3. Convert a MakerWorld profile with a Chinese filename. Check the browser download list for completion, the expected `-U1.3mf` name, and ZIP archive integrity.
4. Convert the same profile again. Check the normal duplicate-name suffix and that the earlier file is preserved.
5. Convert a second model. Each conversion should create one output download without new FDM filename-conflict warnings.
6. Check an ordinary browser download still follows the user's FDM settings.
7. Check reports show `native-html`, `initiated`, `success: null`, and `filenameForced: false`. For API paths, reports should show `accepted` after their response, never claim completed writes, and preserve failure/fallback diagnostics.

Use the normal download flow: automation download interception can override filename handling and hide this regression. Unit tests cannot establish download-manager interoperability. Real IDM and Firefox validation remain separate from stub-based coverage.

## Earlier validation on 2026-10-26 (before v1.8.0 integration)

- All 29 automated tests pass.
- Ego Lite 0.6.0.16 / Chromium 154 on macOS, FDM 3.3.4 enabled throughout, using normal browser downloads without automation interception.
- Legacy true migrated to Force filename (Chrome API) in the installed options UI; explicitly selecting Native HTML persisted across reload.
- Bird-head wand: two completed downloads, each 57,546,261 bytes, correct Chinese filenames and duplicate suffixes. Both 71-member ZIPs pass CRC and their member contents are identical.
- Twin-card profile: completed 17,260,240-byte download with the expected filename; all 60 ZIP members pass CRC.
- Real output report shows `native-html`, `initiated`, `success: null`, `filenameForced: false`, and no download ID.
- Ordinary HTTP attachment completed; both extensions remained enabled without new runtime errors or install warnings. Only test-created downloads were removed afterward.
- IDM and Firefox were not tested in a real browser. The original API handlers and Firefox transport have automated regression coverage; no broader download-manager compatibility is claimed.

## v1.8.0 integration validation

The branch merges upstream v1.8.0 (`8eea99c`). All 44 automated tests pass. New coverage includes local saved-setting migration, all local transports, the original local Firefox callback/binary path, copy-ready output reports, failed normalized retries with configured/actual methods in final operations, and the local conversion lifecycle's success/error reports and UI cleanup.

For manual testing, save the selected method, choose a local `.3mf` in **Convert Local 3MF**, check the generated file and copied report, then repeat via MakerWorld. Invalid local input should still expose the original error code and Copy Error Report control.

On macOS / Ego Lite 0.6.0.16 / Chromium 154, with FDM 3.3.4 enabled:

- A real local dream-card 3MF converted through all three methods. Each output is 15,471,655 bytes, all 42 ZIP members pass CRC, and member contents match across methods.
- Standard retains the existing UUID-filename behavior with this FDM installation. Force filename restores the requested name but retains the known FDM filename-listener warning. Native HTML saves the correct Chinese `.3mf` name without that listener conflict. These existing compatibility differences are why all three methods remain selectable.
- Native local reports show `initiated`; API reports show `accepted`; configured/actual methods and forcing flags agree with the transport.
- A real MakerWorld twin-card conversion with Native HTML completes with the expected filename and a valid 17,260,240-byte ZIP.
- Invalid local ZIP input retains `U1-ZIP-001`, Copy Error Report, and resets the busy state.

IDM and Firefox still have no real-browser verification in this environment. Tests of their API paths are not claims of download-manager interoperability.
