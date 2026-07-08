# Changelog

All notable changes to this project will be documented in this file.

This project follows the principles of **Keep a Changelog** and uses **Semantic Versioning**.

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
