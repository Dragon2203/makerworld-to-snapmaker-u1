// Background script — handles converted file downloads.
//
// Chrome/Chromium:
// Receives a Blob URL created by the content script.
//
// Firefox:
// Receives the finished binary data and creates a new Blob URL inside
// the extension background context, because Firefox blocks access to
// MakerWorld-context Blob URLs from downloads.download().

const isFirefoxBackground =
  chrome.runtime.getURL('').startsWith('moz-extension://');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'u1_download') {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message;

        console.warn('[U1 Extension] download failed:', error);
        sendResponse({ ok: false, error });
        return;
      }

      sendResponse({ ok: true, downloadId });
    });

    return true;
  }

  if (msg?.type === 'u1_download_firefox') {
    if (!isFirefoxBackground) {
      sendResponse({
        ok: false,
        error: 'Firefox download handler is unavailable',
      });
      return false;
    }

    (async () => {
      let objectUrl = null;

      try {
        if (!(msg.data instanceof ArrayBuffer)) {
          throw new TypeError(
            'Firefox download data is not an ArrayBuffer'
          );
        }

        const bytes = new Uint8Array(msg.data);

        if (bytes.byteLength === 0) {
          throw new Error('Firefox download data is empty');
        }

        const blob = new Blob(
          [bytes],
          { type: 'application/octet-stream' }
        );

        objectUrl = URL.createObjectURL(blob);

        const downloadId = await browser.downloads.download({
          url: objectUrl,
          filename: msg.filename,
          saveAs: false,
        });

        sendResponse({
          ok: true,
          downloadId,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          '[U1 Extension] Firefox download failed:',
          message
        );

        sendResponse({
          ok: false,
          error: message,
        });
      } finally {
        if (objectUrl) {
          // Keep the URL alive long enough for Firefox's download manager
          // to open it before releasing the temporary Blob resource.
          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
          }, 60_000);
        }
      }
    })();

    return true;
  }

  return false;
});