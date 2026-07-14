# Changelog

All notable changes to this project will be documented in this file.

This project follows the principles of **Keep a Changelog** and uses **Semantic Versioning**.

## [1.1.1] - 2026-07-14

### Fixed

- Fixed 3MF download detection on non-English MakerWorld languages.
- Improved alignment of the conversion button content and loading icon.
- Replaced the misleading "select a print profile first" error with a more accurate 3MF download option error.

### Build

- Added README, changelog, license and third-party notice files to the generated browser packages.

### Documentation

- Added Chrome/Chromium update instructions to the README.

---

## [1.1.0] - 2026-07-12

### Added

* Official Mozilla Firefox support.
* Dedicated Firefox manifest and background-script configuration.
* Separate Chrome/Chromium and Firefox build packages.
* PowerShell build script for generating browser-specific release folders, release archives and Mozilla source packages.
* Firefox-compatible download pipeline for converted `.3mf` files.

### Improved

* Conversion success and failure states now remain visible until the user interacts with another MakerWorld element or starts another conversion.
* Download handling now waits for confirmation from the browser before displaying a successful conversion state.
* Improved cross-browser storage handling for Chrome, Chromium and Firefox.
* Improved Firefox compatibility for large binary `.3mf` projects and JSZip processing.
* Converter report now reads the installed extension version directly from the active browser manifest.
* Chrome and Firefox now use the same shared converter, content script and background code.
* Replaced all project-specific `innerHTML` usage with DOM API creation (`createElement`, `textContent`, `append`) to improve security and satisfy Firefox Add-on validation.

### Fixed

* Fixed Firefox failing to process binary project data across isolated JavaScript contexts.
* Fixed Firefox being unable to download Blob URLs created in the MakerWorld page context.
* Fixed Chrome being incorrectly detected as Firefox on browsers exposing a compatible `browser` namespace.
* Fixed the converter report displaying an outdated hard-coded version number.
* Removed the unused hard-coded converter status field.

---

## [1.0.0] - 2026-07-07

### Added

* Initial public release of the MakerWorld to Snapmaker U1 Chrome extension.
* Direct integration into MakerWorld through a dedicated Snapmaker U1 printer option.
* Local browser-based conversion without external services.
* Automatic print profile detection and matching to Snapmaker U1 system presets.
* Optional forced print profile selection.
* Filament preset modes (Preserve / Force Generic).
* Automatic filament mapping.
* Project parser for MakerWorld `.3mf` files.
* Compatibility layer for known Snapmaker Orca limitations.
* Metadata conversion and printer profile remapping.
* Detailed compatibility and conversion report.
* Configurable converter options page.

### Improved

* Modular converter architecture with dedicated parser, builder and compatibility modules.
* Improved preservation of compatible project settings.
* Better handling of multi-material projects and color painting.
* Improved print profile recognition.
* Improved compatibility with large MakerWorld projects.
* Improved download handling and browser integration.

### Fixed

* Correct handling of MakerWorld downloads across supported Chromium browsers.
* Improved compatibility with localized MakerWorld pages.
* Multiple compatibility fixes for Snapmaker Orca project conversion.
* Various stability, performance and reliability improvements.

---

Future releases will be documented here.
