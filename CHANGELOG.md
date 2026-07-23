# Changelog

All notable changes to this project will be documented in this file.

This project follows the principles of **Keep a Changelog** and uses **Semantic Versioning**.

## [1.4.1] - 2026-07-23

### Improved

- Improved OrcaSlicer compatibility by automatically normalizing several required filament arrays.
- Improved compatibility with MakerWorld projects containing more than four filament slots.
- Improved handling of invalid `raft_first_layer_expansion` values by restoring the native U1 profile default.

### Fixed

- Fixed an OrcaSlicer crash caused by empty `filament_adaptive_volumetric_speed` entries.
- Fixed invalid project configuration warnings caused by inconsistent `filament_self_index` values.
- Fixed `filament_flush_temp` warnings shown when opening converted projects.
- Fixed negative `raft_first_layer_expansion` values causing compatibility warnings in Snapmaker Orca and OrcaSlicer.

## [1.4.0] - 2026-07-20

### Added

- Added optional OrcaSlicer compatibility mode.
- Added support for importing custom OrcaSlicer printer profiles.

### Improved

- Improved the converter settings page with a redesigned printer profile management section.

## [1.3.0] - 2026-07-18

### Added

- Added automatic positioning correction for multi-plate MakerWorld projects.
- Added automatic compensation for differences between the source printer and Snapmaker U1 build-plate centers and plate-grid spacing.
- Added multi-plate diagnostics to the converter report, including detected grid dimensions, adjusted and skipped plates, unresolved instances, center offset, grid difference and maximum movement.
- Added a converter option for enabling or disabling multi-plate positioning correction.

### Improved

- Improved preservation of filament-specific project settings for preserved source filaments.
- Improved handling of Bambu filament setting arrays that contain paired current and default values.
- Improved safety of multi-plate conversion by validating every instance before changing a plate.
- Multi-plate positioning now leaves an entire plate unchanged if any instance cannot be linked or positioned safely.
- Single-plate projects remain unchanged by the multi-plate positioning feature.

### Fixed

- Fixed **Maximum Volumetric Speed** and other per-filament settings being read from the wrong array position in some MakerWorld projects.
- Fixed preserved project filaments potentially receiving incorrect or unrelated filament values in Snapmaker Orca.
- Fixed objects from multi-plate MakerWorld projects appearing on incorrect plate positions after conversion to the Snapmaker U1 build-plate layout.

---

## [1.2.0] - 2026-07-14

### Improved

- Significantly improved conversion performance for large MakerWorld projects.
- Moved the reverse-engineering diagnostics behind the optional Deep Debug mode.
- Reduced ZIP generation time by using a more efficient compression level.
- Simplified and reorganized the converter report for improved readability.
- Added a detailed performance breakdown to help identify conversion bottlenecks.

### Changed

- Reverse-engineering diagnostics are now only executed when **Deep Debug Report** is enabled.
- Removed reverse-engineering-only information from the standard converter report.

---

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
