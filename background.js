// Service worker — handles file downloads on behalf of the content script.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'u1_download') return false;

  chrome.downloads.download({
    url: msg.url,
    filename: msg.filename,
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('[U1 Extension] download failed:', chrome.runtime.lastError.message);
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }

    sendResponse({ ok: true, downloadId });
  });

  return true;
});