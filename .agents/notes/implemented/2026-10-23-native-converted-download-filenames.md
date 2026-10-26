# Agent Note: Native filenames for the Chromium compatibility option

Status: implemented

Superseded-by: [Selectable download methods](2026-10-26-selectable-download-methods.md)

## Problem

With Free Download Manager enabled, Chromium can discard the filename passed to `downloads.download()` and save a converted Blob as its UUID. The existing filename-forcing workaround restores the name through `onDeterminingFilename`, but this competes with FDM's listener and produces a persistent extension warning even when the download completes. FDM already skips Blob URLs; its globally registered filename listener still participates in arbitration.

## Decision

The existing opt-in `forceDownloadFilename` setting uses a native Blob link with a `download` filename. The link stays detached because the extension's injected page script cancels connected download links while U1 mode is active. The existing filename normalizer runs before the native save, since native links do not return the download API's invalid-filename error. The report records the normalized name when applicable.

The unused forced-filename background listener and session bookkeeping are removed. The default Chromium API path and Firefox binary-message path remain intact. Blob URLs retain the existing 60-second delayed cleanup.

## Alternatives considered

Disabling filename forcing preserves the UUID regression for affected users. Excluding MakerWorld in FDM does not remove the global filename listener, and disabling FDM changes unrelated downloads. Keeping both filename listeners and clearing warnings only hides the symptom until another conversion.

Replacing every browser's download path would expand the compatibility change unnecessarily. The native path is limited to users who already opt into the workaround.

## Consequences

The native link supplies the requested name without adding another extension filename suggestion. It does not return a download ID or confirm that the browser completed the save; the existing output stage reports initiation. Browser download restrictions and user cancellation still require checking the download UI.

[Regression checks](../../../tests/README.md) cover transport selection, normalization and error reporting. Manual testing with a real download-manager extension is required because API stubs do not reproduce Chromium's filename arbitration.
