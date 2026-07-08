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

## Data the extension accesses

| Data | Purpose | Stored? | Transmitted? |
|---|---|---|---|
| MakerWorld page DOM | Inject U1 carousel option and intercept download | No | No |
| `.3mf` file downloaded from MakerWorld | In-browser conversion | No | No |
| Extension settings (print profile, converter options and user preferences) | User preferences | Browser storage only | No |

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

User settings (selected print profile, converter options, filament preset mode 
and other user preferences) are stored in `chrome.storage.sync`. This storage is managed by
the browser and may be synced across devices by the browser's built-in sync
feature if the user has browser sync enabled. No settings data is transmitted
to servers operated by this project.

## Analytics and telemetry

This extension does not include analytics, crash reporting, telemetry, or
remote error reporting of any kind.

## Third-party services

The extension interacts only with:

- **MakerWorld** (`makerworld.com`) — to intercept the user-initiated download
- **Chrome extension APIs** — for storage and downloads

No other third-party services are contacted by this extension.

## MakerWorld's own privacy policy

Accessing MakerWorld is subject to MakerWorld's own privacy policy and terms
of service. This extension does not modify or override those policies.

## Changes

If the extension's data practices change in a future version, this file will
be updated accordingly.
