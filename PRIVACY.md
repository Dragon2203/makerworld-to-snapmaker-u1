# Privacy Statement

**MakerWorld to Snapmaker U1 — Chrome Extension**

This document describes what data the extension accesses and how it is handled,
based on the current implementation.

---

## What the extension does

The extension operates on MakerWorld model pages to:

1. Inject a Snapmaker U1 option into the printer filter carousel.
2. Intercept MakerWorld's own authenticated `.3mf` download when the user
   clicks **Convert to Snapmaker U1**.
3. Convert the downloaded `.3mf` file locally in the browser using bundled
   JavaScript logic.
4. Trigger a file download of the converted `.3mf` to the user's device.

For local file conversion, users can manually select or drag and drop an
existing `.3mf` file into the extension's settings page. The file is read,
converted and downloaded entirely within the browser without being uploaded
to an external conversion service.

## Data the extension accesses

| Data | Purpose | Stored? | Transmitted? |
|---|---|---|---|
| MakerWorld page DOM | Integrate the U1 conversion option and detect download actions | No | No |
| MakerWorld `.3mf` project files | In-browser conversion | No | No additional transmission by the extension |
| User-selected local `.3mf` files | In-browser conversion | No | No |
| Extension settings and preferences | Preserve user configuration | Browser sync storage | May be synced by the browser |
| Imported custom printer profiles | Apply user-defined printer settings during conversion | Browser local storage | No |
| Conversion diagnostics and error reports | Display conversion information and help troubleshoot problems | Temporarily in browser memory | Only if manually shared by the user |


## Credentials and authentication

The extension uses MakerWorld's existing authenticated download flow by
intercepting the network request that MakerWorld itself initiates when the
user clicks its own download button. The extension does not:

- Read, log, or store MakerWorld passwords
- Read, copy, or transmit browser cookies or session tokens
- Make authenticated requests to MakerWorld on its own, separate from the
  user's own browser session

## Local processing

The downloaded `.3mf` file is converted entirely within the browser using
bundled JavaScript code. The file is not uploaded to any server operated by
this project.

## Extension storage

The extension uses the browser's built-in extension storage APIs to preserve
user settings and imported custom printer profiles.

### User settings

General converter settings, including print profile selection, filament
handling preferences, compatibility options and other user preferences,
are stored in `chrome.storage.sync`.

This storage is managed by the browser and may be synchronized across devices
through the browser's built-in synchronization feature if enabled by the user.

### Custom printer profiles

Custom printer profiles manually imported by the user are stored in
`chrome.storage.local`.

Profiles for Snapmaker Orca and OrcaSlicer are stored separately.

These imported profiles remain in the browser's local extension storage
and are not uploaded to servers operated by this project.

### Temporary download state

The extension may temporarily store download-related state using the browser's
session storage to manage active downloads.

No extension settings or imported printer profiles are transmitted to
servers operated by this project.

## Analytics and telemetry

This extension does not include analytics, crash reporting, telemetry, or
automatic remote error reporting of any kind.

## Diagnostic reports

The extension can generate conversion reports and detailed error reports
to help users understand conversion results and troubleshoot problems.

These reports may contain technical information such as file names, file
sizes, conversion settings, processing stages, error messages and
browser-related information.

Reports are generated locally in the browser and are not automatically
transmitted to the developer or any external reporting service.

Users may manually copy and share these reports, for example when
submitting a GitHub issue.

Users should review diagnostic reports before sharing them publicly.

## Third-party services

The extension interacts only with:

- **MakerWorld** (`makerworld.com` and `makerworld.com.cn`) — to integrate
  conversion functionality and process user-initiated project downloads.
- **Browser extension APIs** — for storing settings, managing imported
  printer profiles and downloading converted files.

No other third-party services are contacted by this extension.

## MakerWorld's own privacy policy

Accessing MakerWorld is subject to MakerWorld's own privacy policy and terms
of service. This extension does not modify or override those policies.

## Changes

If the extension's data practices change in a future version, this file will
be updated accordingly.
