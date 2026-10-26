# Agent Note: Preserve compatibility with three download methods

Status: implemented

## Problem

The native Blob workaround fixes the FDM filename-listener conflict, but FDM validation does not establish compatibility with IDM or other download managers. Replacing the existing forcing path can regress users who depend on it. A native link click also cannot truthfully be reported as an applied filename-forcing callback or confirmed browser acceptance.

## Decision

The download method is an explicit three-way setting: `chrome-api` (default), `chrome-api-force` (the original workaround), or `native-html` (detached Blob link). This supersedes the replacement decision in [the original native-download note](2026-10-23-native-converted-download-filenames.md) following [the maintainer's review](https://github.com/Dragon2203/makerworld-to-snapmaker-u1/pull/10#issuecomment-6357988821).

The shared resolver uses a null storage default so it can distinguish an absent method from an explicit Standard selection. A legacy true value retains `chrome-api-force`; false/new installations retain Standard. An explicit method wins. Resolution happens on read without requiring the settings page to be opened; saving persists the method and a matching legacy boolean. Firefox keeps its binary pipeline and the selector is disabled there.

The background API implementations are restored; their only changes relative to the base are method metadata on Chromium responses. In particular, failure to store forced-download state retains the standard API fallback and reports that actual transport. Native links remain detached because the page interceptor cancels connected download links. Native filenames are normalized before clicking; API methods preserve the original attempt followed by an invalid-filename retry.

Existing project/error reports carry configured method, actual transport, attempt result, and status. `filenameForced` retains the listener-applied meaning. Native clicks produce `initiated` with `success: null` and no download ID. API responses produce `accepted`; neither establishes completion on disk. Existing error codes and diagnostic flow remain intact.

## Alternatives considered

Replacing the old mechanism with native HTML is rejected because only FDM interoperability has been demonstrated. Automatically migrating all forced users to HTML would reproduce that compatibility risk even with three visible choices.

Keeping a second reporting system would duplicate normalization and error paths. The existing output-download report, metadata and error renderer are extended instead.

## Consequences

Users can choose compatibility behavior without losing their previous workaround. The small shared settings resolver is loaded by both options and content scripts and included in both release packages/source archives. Tests exercise defaults, explicit precedence, settings UI/save, transports, background listener cleanup/storage fallback, filename retries, and report semantics. Browser-level download-manager interaction still requires real downloads; mock tests do not establish IDM interoperability or Firefox browser behavior.
