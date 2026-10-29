// Shared by the settings page and content script. A null storage default keeps
// the legacy boolean visible until an explicit method is saved.
function resolveU1DownloadMethod(settings = {}) {
  if (
    settings.downloadMethod === 'chrome-api' ||
    settings.downloadMethod === 'chrome-api-force' ||
    settings.downloadMethod === 'native-html'
  ) {
    return settings.downloadMethod;
  }

  return settings.forceDownloadFilename === true
    ? 'chrome-api-force'
    : 'chrome-api';
}
