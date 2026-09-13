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

const pendingU1DownloadResponses =
  new Map();

let u1FilenameListenerRegistered =
  false;

function getU1PendingDownloadStorageKey(
  url
) {
  return (
    'u1-pending-download:' +
    String(url || '')
  );
}

function getU1DownloadBasename(
  filename
) {
  const value =
    String(filename || '');

  return (
    value
      .split(/[\\/]/)
      .pop() ||
    value
  );
}

function removeU1FilenameListenerIfIdle() {
  if (
    pendingU1DownloadResponses.size > 0 ||
    !u1FilenameListenerRegistered
  ) {
    return;
  }

  try {
    chrome.downloads
      .onDeterminingFilename
      .removeListener(
        handleU1DeterminingFilename
      );
  } catch {
    // Nothing to clean up.
  }

  u1FilenameListenerRegistered =
    false;
}

function cleanupU1PendingDownload(
  storageKey
) {
  pendingU1DownloadResponses.delete(
    storageKey
  );

  chrome.storage.session.remove(
    storageKey
  );

  removeU1FilenameListenerIfIdle();
}

function completeU1DownloadResponse(
  storageKey,
  downloadId,
  filenameForced
) {
  const pendingResponse =
    pendingU1DownloadResponses.get(
      storageKey
    );

  if (!pendingResponse) {
    return;
  }

  cleanupU1PendingDownload(
    storageKey
  );

  pendingResponse({
    ok:
      true,

    downloadId:
      downloadId ??
      null,

    filenameForced:
      filenameForced ===
      true,
  });
}

function ensureU1FilenameListener() {
  if (
    u1FilenameListenerRegistered ||
    isFirefoxBackground ||
    !chrome.downloads
      ?.onDeterminingFilename
  ) {
    return;
  }

  chrome.downloads
    .onDeterminingFilename
    .addListener(
      handleU1DeterminingFilename
    );

  u1FilenameListenerRegistered =
    true;
}

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Optional Chromium filename forcing.
//
// This listener is registered only while a converted U1 download explicitly
// requests filename forcing. With the option disabled, Chromium uses the
// normal downloads.download({ filename }) path without this listener.

function handleU1DeterminingFilename(
  downloadItem,
  suggest
) {
  // Never interfere with a download explicitly attributed to another
  // extension.
  if (
    downloadItem.byExtensionId &&
    downloadItem.byExtensionId !==
      chrome.runtime.id
  ) {
    suggest();
    return;
  }

  const candidateUrls =
    Array.from(
      new Set(
        [
          downloadItem.url,
          downloadItem.finalUrl,
        ].filter(Boolean)
      )
    );

  const storageKeys =
    candidateUrls.map(
      getU1PendingDownloadStorageKey
    );

  if (!storageKeys.length) {
    suggest();
    return;
  }

  chrome.storage.session.get(
    storageKeys,
    stored => {
      if (
        chrome.runtime.lastError
      ) {
        console.warn(
          '[U1 Extension] forced filename state read failed:',
          chrome.runtime.lastError.message
        );

        suggest();
        return;
      }

      let pendingKey =
        null;

      let pending =
        null;

      for (
        const key of
        storageKeys
      ) {
        if (
          stored?.[key]
            ?.forceFilename === true
        ) {
          pendingKey =
            key;

          pending =
            stored[key];

          break;
        }
      }

      // Not one of the currently pending forced U1 downloads.
      if (
        !pendingKey ||
        !pending
      ) {
        suggest();
        return;
      }

      const expectedFilename =
        getU1DownloadBasename(
          pending.expectedFilename
        );

      if (!expectedFilename) {
        console.warn(
          '[U1 Extension] forced filename is empty'
        );

        suggest();

        completeU1DownloadResponse(
          pendingKey,
          downloadItem.id,
          false
        );

        return;
      }

      suggest({
        filename:
          expectedFilename,

        conflictAction:
          'uniquify',
      });

      completeU1DownloadResponse(
        pendingKey,
        downloadItem.id,
        true
      );
    }
  );

  // chrome.storage.session is asynchronous.
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'u1_download') {
    const forceFilename =
      msg.forceFilename === true;

    // Normal/default path.
    //
    // Do not arm the filename listener at all when forcing is disabled.
    // Chromium receives exactly the same explicit filename as before.
    if (!forceFilename) {
      chrome.downloads.download(
        {
          url:
            msg.url,

          filename:
            msg.filename,

          conflictAction:
            'uniquify',
        },
        downloadId => {
          if (
            chrome.runtime.lastError
          ) {
            const error =
              chrome.runtime
                .lastError.message;

            console.warn(
              '[U1 Extension] download failed:',
              error
            );

            sendResponse({
              ok:
                false,

              error,
            });

            return;
          }

          sendResponse({
            ok:
              true,

            downloadId:
              downloadId ??
              null,

            filenameForced:
              false,
          });
        }
      );

      return true;
    }

    // Optional forced-filename compatibility path.
    const storageKey =
      getU1PendingDownloadStorageKey(
        msg.url
      );

    const pendingDownload = {
      url:
        String(msg.url || ''),

      expectedFilename:
        String(msg.filename || ''),

      forceFilename:
        true,

      createdAt:
        Date.now(),
    };

    pendingU1DownloadResponses.set(
      storageKey,
      sendResponse
    );

    ensureU1FilenameListener();

    const startForcedDownload =
      () => {
        chrome.downloads.download(
          {
            url:
              msg.url,

            filename:
              msg.filename,

            conflictAction:
              'uniquify',
          },
          downloadId => {
            if (
              chrome.runtime.lastError
            ) {
              const error =
                chrome.runtime
                  .lastError.message;

              cleanupU1PendingDownload(
                storageKey
              );

              console.warn(
                '[U1 Extension] download failed:',
                error
              );

              sendResponse({
                ok:
                  false,

                error,
              });

              return;
            }

            // Successful forced downloads are reported by
            // onDeterminingFilename after the explicit filename suggestion
            // has been applied.
          }
        );
      };

    chrome.storage.session.set(
      {
        [storageKey]:
          pendingDownload,
      },
      () => {
        if (
          chrome.runtime.lastError
        ) {
          const storageError =
            chrome.runtime
              .lastError.message;

          console.warn(
            '[U1 Extension] forced filename state could not be stored:',
            storageError
          );

          // Do not risk blocking the download when the optional forcing state
          // cannot be prepared. Fall back to the normal Chromium path.
          cleanupU1PendingDownload(
            storageKey
          );

          chrome.downloads.download(
            {
              url:
                msg.url,

              filename:
                msg.filename,

              conflictAction:
                'uniquify',
            },
            downloadId => {
              if (
                chrome.runtime.lastError
              ) {
                const error =
                  chrome.runtime
                    .lastError.message;

                sendResponse({
                  ok:
                    false,

                  error,
                });

                return;
              }

              sendResponse({
                ok:
                  true,

                downloadId:
                  downloadId ??
                  null,

                filenameForced:
                  false,
              });
            }
          );

          return;
        }

        startForcedDownload();
      }
    );

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