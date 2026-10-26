// Shared converted-output download workflow for MakerWorld and local 3MF files.
// Both callers retain their input naming, UI, and conversion lifecycle.

function isU1InvalidFilenameError(
  errorMessage
) {
  return /invalid filename/i.test(
    String(errorMessage || '')
  );
}

function truncateU1DownloadFilename(
  filename,
  maxCodePoints = 180
) {
  const value =
    String(filename || '');

  const characters =
    Array.from(value);

  if (
    characters.length <=
    maxCodePoints
  ) {
    return value;
  }

  const extension =
    /\.3mf$/i.test(value)
      ? '.3mf'
      : '';

  const extensionLength =
    Array.from(extension).length;

  const availableLength =
    Math.max(
      1,
      maxCodePoints -
      extensionLength
    );

  const truncatedBase =
    characters
      .slice(
        0,
        availableLength
      )
      .join('')
      .replace(/[.\s]+$/g, '');

  return (
    truncatedBase ||
    'model-U1'
  ) + extension;
}

function createU1DownloadFilenameFallback(
  filename
) {
  const original =
    String(filename || '');

  let fallback =
    original;

  try {
    fallback =
      fallback.normalize('NFC');
  } catch {
    // Keep the original representation when Unicode normalization
    // is unavailable for any reason.
  }

  fallback =
    fallback
      // Replace invisible Unicode formatting characters such as:
      // - Zero Width Joiner
      // - Zero Width Non-Joiner
      // - directional formatting markers
      // - word joiner
      // - byte order mark
      //
      // Surrounding visible emoji characters remain intact.
      .replace(
        /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
        '_'
      )

      // Replace control characters.
      .replace(
        /[\u0000-\u001F\u007F-\u009F]/g,
        '_'
      )

      // Replace characters which are invalid in Windows filenames or
      // interpreted as path separators by browser download APIs.
      .replace(
        /[<>:"/\\|?*]/g,
        '_'
      )

      // Collapse separators created by consecutive invalid or invisible
      // characters without changing existing single underscores.
      .replace(
        /_{2,}/g,
        '_'
      )

      // File names ending in spaces or periods are invalid on Windows.
      .replace(
        /[.\s]+$/g,
        ''
      )

      // Avoid leading spaces and periods.
      .replace(
        /^[.\s]+/g,
        '');

  if (
    !fallback ||
    fallback === '.' ||
    fallback === '..'
  ) {
    fallback =
      'model-U1.3mf';
  }

  const extensionMatch =
    fallback.match(
      /\.3mf$/i
    );

  const extension =
    extensionMatch
      ? extensionMatch[0]
      : '';

  const baseName =
    extension
      ? fallback.slice(
          0,
          -extension.length
        )
      : fallback;

  // Windows reserves these names even when a file extension is present.
  if (
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(
      baseName
    )
  ) {
    fallback =
      `_${baseName}${extension}`;
  }

  fallback =
    truncateU1DownloadFilename(
      fallback
    );

  if (
    !fallback ||
    fallback === '.3mf'
  ) {
    fallback =
      'model-U1.3mf';
  }

  return {
    original,
    fallback,

    changed:
      fallback !== original,
  };
}

function createU1OutputDownloadError(
  errorMessage,
  downloadReport
) {
  const error =
    new Error(
      String(
        errorMessage ||
        'Download could not be started'
      )
    );

  error.u1DiagnosticContext = {
    operation:
      'start-converted-file-download',

    configuredDownloadMethod:
      downloadReport.configuredDownloadMethod,
    downloadMethod:
      downloadReport.downloadMethod,
    downloadStatus:
      downloadReport.status,

    browser:
      downloadReport.browser,

    failedAttempt:
      downloadReport.failedAttempt,

    originalFilename:
      downloadReport.originalFilename,

    fallbackFilename:
      downloadReport.fallbackFilename,

    finalFilename:
      downloadReport.finalFilename,

    filenameFallbackAvailable:
      downloadReport.fallbackAvailable,

    filenameFallbackUsed:
      downloadReport.fallbackUsed,

    filenameNormalizationChanged:
      downloadReport.normalizationChanged,

    forceFilename:
      downloadReport.forceFilename,

    filenameForced:
      downloadReport.filenameForced,

    downloadAttempts:
      downloadReport.attempts,
  };

  return error;
}

function logU1OutputDownloadReportSafe(
  downloadReport,
  enabled = true
) {
  if (!enabled) return;

  try {
    if (
      typeof logU1OutputDownloadReport ===
      'function'
    ) {
      logU1OutputDownloadReport(
        downloadReport
      );
    }
  } catch (reportError) {
    console.warn(
      '[U1 Extension] Could not log output download report:',
      reportError
    );
  }
}

async function downloadU1Output({
  converted,
  outName,
  currentSettings,
  diagnostics,
  isFirefox,
  activeTestFault = 'none',
  sendFirefoxDownload = message => browser.runtime.sendMessage(message),
}) {
  const filenameFallback =
    createU1DownloadFilenameFallback(
      outName
    );

  const downloadMethod =
    resolveU1DownloadMethod(currentSettings);
  const actualDownloadMethod =
    isFirefox ? 'firefox' : downloadMethod;

  const downloadReport = {
    configuredDownloadMethod:
      downloadMethod,
    downloadMethod:
      actualDownloadMethod,
    status: 'pending',

    browser:
      isFirefox
        ? 'Firefox'
        : 'Chrome/Chromium',

    originalFilename:
      outName,

    fallbackFilename:
      filenameFallback.changed
        ? filenameFallback.fallback
        : null,

    finalFilename:
      null,

    fallbackAvailable:
      filenameFallback.changed,

    fallbackUsed:
      false,

    normalizationChanged:
      filenameFallback.changed,

    forceFilename:
      !isFirefox &&
      downloadMethod === 'chrome-api-force',

    filenameForced:
      false,

    failedAttempt:
      null,

    success:
      false,

    attempts:
      [],
  };

  diagnostics.setMetadata({
    outputDownloadConfiguredMethod:
      downloadMethod,
    outputDownloadMethod:
      actualDownloadMethod,
    outputDownloadStatus: 'pending',

    outputDownloadOriginalFilename:
      downloadReport.originalFilename,

    outputDownloadFallbackFilename:
      downloadReport.fallbackFilename,

    outputDownloadFinalFilename:
      null,

    outputDownloadFallbackAvailable:
      downloadReport.fallbackAvailable,

    outputDownloadFallbackUsed:
      false,

    outputDownloadForceFilename:
      downloadReport.forceFilename,

    outputDownloadFilenameForced:
      false,

    outputDownloadAttempts:
      [],
  });

  diagnostics.startStage(
    U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD,
    getU1DiagnosticStageLabel(
      U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD
    ),
    {
      configuredDownloadMethod:
        downloadReport.configuredDownloadMethod,
      downloadMethod:
        downloadReport.downloadMethod,

      browser:
        downloadReport.browser,

      filename:
        outName,

      originalFilename:
        outName,

      fallbackFilename:
        downloadReport.fallbackFilename,

      filenameFallbackAvailable:
        downloadReport.fallbackAvailable,

      outputBytes:
        converted.byteLength,
    }
  );

  throwU1SimulatedFault(
    activeTestFault,
    'output-download-failure',
    'Simulated converted file download failure.'
  );

  let releaseOutputUrl =
    null;

  let attemptOutputDownload;

  if (isFirefox) {
    const downloadData =
      converted.buffer.slice(
        converted.byteOffset,
        converted.byteOffset +
        converted.byteLength
      );

    attemptOutputDownload =
      async filename =>
        sendFirefoxDownload({
          type:
            'u1_download_firefox',

          data:
            downloadData,

          filename,
        });
  } else {
    const outBlob =
      new Blob(
        [converted],
        {
          type:
            'application/octet-stream',
        }
      );

    const outUrl =
      URL.createObjectURL(
        outBlob
      );

    releaseOutputUrl =
      outUrl;

    attemptOutputDownload =
      filename =>
        new Promise(
          (resolve, reject) => {
            if (downloadMethod === 'native-html') {
              // A native Blob download suggests the filename without
              // competing with download-manager extensions. Keep the link
              // detached: injected.js blocks connected download links in U1 mode.
              const link = document.createElement('a');
              link.href = outUrl;
              link.download = filename;
              link.click();

              resolve({
                ok: true,
                downloadMethod: 'native-html',
                filenameForced: false,
              });
              return;
            }

            chrome.runtime.sendMessage(
              {
                type:
                  'u1_download',

                forceFilename:
                  downloadMethod === 'chrome-api-force',

                url:
                  outUrl,

                filename,
              },
              response => {
                if (
                  chrome.runtime.lastError
                ) {
                  reject(
                    new Error(
                      chrome.runtime
                        .lastError.message
                    )
                  );

                  return;
                }

                resolve(
                  response || {
                    ok:
                      false,

                    error:
                      'Download handler returned no response',
                  }
                );
              }
            );
          }
        );
  }

  async function runOutputDownloadAttempt(
    type,
    filename
  ) {
    const attempt = {
      attempt:
        downloadReport.attempts.length +
        1,

      type,
      configuredDownloadMethod:
        downloadMethod,
      downloadMethod:
        actualDownloadMethod,

      filename,

      result:
        'running',

      error:
        null,

      downloadId:
        null,

      filenameForced:
        false,
    };

    downloadReport.attempts.push(
      attempt
    );

    const operation = {
      configuredDownloadMethod:
        downloadReport.configuredDownloadMethod,
      downloadMethod:
        actualDownloadMethod,

      operation:
        'start-converted-file-download',

      downloadAttempt:
        attempt.attempt,

      downloadAttemptType:
        type,

      filename,

      originalFilename:
        downloadReport.originalFilename,

      fallbackFilename:
        downloadReport.fallbackFilename,

      filenameFallbackUsed:
        type === 'normalized-fallback',

      forceFilename:
        downloadReport.forceFilename,

      outputBytes:
        converted.byteLength,
    };

    diagnostics.setOperation(operation);

    try {
      const response =
        await attemptOutputDownload(
          filename
        );

      attempt.downloadMethod =
        response?.downloadMethod || actualDownloadMethod;
      downloadReport.downloadMethod = attempt.downloadMethod;

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          'Download could not be started'
        );
      }

      attempt.result =
        attempt.downloadMethod === 'native-html'
        ? 'initiated'
        : 'accepted';
      downloadReport.status = attempt.result;

      attempt.downloadId =
        response.downloadId ??
        null;

      attempt.filenameForced =
        response.filenameForced ===
        true;

      if (
        attempt.filenameForced
      ) {
        downloadReport.filenameForced =
          true;
      }

      return {
        ok:
          true,

        response,
        attempt,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      attempt.result =
        'failed';
      downloadReport.status = 'failed';

      attempt.error =
        message;

      return {
        ok:
          false,

        error:
          message,

        originalError:
          error,

        attempt,
      };
    } finally {
      diagnostics.setOperation({
        ...operation,

        downloadMethod:
          attempt.downloadMethod,

        downloadStatus:
          attempt.result,
      });

      diagnostics.setMetadata({
        outputDownloadMethod:
          downloadReport.downloadMethod,
        outputDownloadStatus:
          downloadReport.status,

        outputDownloadFilenameForced:
          downloadReport.filenameForced,

        outputDownloadAttempts:
          downloadReport.attempts.map(
            item => ({
              ...item,
            })
          ),
      });
    }
  }

  try {
    // Native links do not report invalid-filename errors, so normalize
    // before clicking instead of waiting for the download API to reject it.
    const normalizeBeforeDownload =
      actualDownloadMethod === 'native-html' &&
      downloadReport.fallbackAvailable;

    downloadReport.fallbackUsed =
      normalizeBeforeDownload;

    const originalAttempt =
      await runOutputDownloadAttempt(
        normalizeBeforeDownload
          ? 'normalized-fallback'
          : 'original',
        normalizeBeforeDownload
          ? downloadReport.fallbackFilename
          : downloadReport.originalFilename
      );

    if (originalAttempt.ok) {
      // Native clicks have no browser acceptance receipt. API acceptance
      // also does not establish that the file finished writing to disk.
      downloadReport.success =
        downloadReport.status === 'accepted' ? true : null;

      downloadReport.finalFilename =
        originalAttempt.attempt.filename;
    } else if (
      !normalizeBeforeDownload &&
      isU1InvalidFilenameError(
        originalAttempt.error
      ) &&
      downloadReport.fallbackAvailable
    ) {
      downloadReport.fallbackUsed =
        true;

      let fallbackAttempt;

      if (
        activeTestFault ===
        'output-download-fallback-failure'
      ) {
        const simulatedMessage =
          'Simulated normalized filename fallback download failure.';

        const attempt = {
          attempt:
            downloadReport.attempts.length +
            1,

          type:
            'normalized-fallback',

          configuredDownloadMethod:

            downloadMethod,
          downloadMethod:
            actualDownloadMethod,

          filename:
            downloadReport.fallbackFilename,

          result:
            'failed',

          error:
            simulatedMessage,

          downloadId:
            null,
        };

        downloadReport.attempts.push(
          attempt
        );

        diagnostics.setMetadata({
          outputDownloadAttempts:
            downloadReport.attempts.map(
              item => ({
                ...item,
              })
            ),
        });

        const simulatedError =
          new Error(
            simulatedMessage
          );

        simulatedError.name =
          'U1SimulatedFaultError';

        simulatedError.u1Simulated =
          true;

        simulatedError.u1SimulatedFault =
          activeTestFault;

        fallbackAttempt = {
          ok:
            false,

          error:
            simulatedMessage,

          originalError:
            simulatedError,

          attempt,
        };
      } else {
        fallbackAttempt =
          await runOutputDownloadAttempt(
            'normalized-fallback',
            downloadReport.fallbackFilename
          );
      }

      if (fallbackAttempt.ok) {
        downloadReport.success =
          true;

        downloadReport.finalFilename =
          downloadReport.fallbackFilename;
      } else {
        downloadReport.status = 'failed';
        downloadReport.failedAttempt =
          'normalized-fallback';

        downloadReport.finalFilename =
          downloadReport.fallbackFilename;

        diagnostics.setMetadata({
          outputDownloadMethod:
            downloadReport.downloadMethod,
          outputDownloadStatus:
            downloadReport.status,

          outputDownloadFinalFilename:
            downloadReport.finalFilename,

          outputDownloadFallbackUsed:
            true,

          outputDownloadFailedAttempt:
            downloadReport.failedAttempt,

          outputDownloadAttempts:
            downloadReport.attempts.map(
              item => ({
                ...item,
              })
            ),
        });

        logU1OutputDownloadReportSafe(
          downloadReport,
          currentSettings.debugReport !== false
        );

        const downloadError =
          createU1OutputDownloadError(
            fallbackAttempt.error,
            downloadReport
          );

        if (
          fallbackAttempt.originalError
            ?.u1Simulated === true
        ) {
          downloadError.name =
            'U1SimulatedFaultError';

          downloadError.u1Simulated =
            true;

          downloadError.u1SimulatedFault =
            fallbackAttempt.originalError
              .u1SimulatedFault;
        }

        diagnostics.setOperation({
          configuredDownloadMethod:
            downloadReport.configuredDownloadMethod,

          downloadMethod:
            downloadReport.downloadMethod,

          downloadStatus:
            downloadReport.status,

          operation:
            'start-converted-file-download',

          browser:
            downloadReport.browser,

          downloadAttempt:
            2,

          downloadAttemptType:
            'normalized-fallback',

          filename:
            downloadReport.fallbackFilename,

          originalFilename:
            downloadReport.originalFilename,

          fallbackFilename:
            downloadReport.fallbackFilename,

          finalFilename:
            downloadReport.finalFilename,

          filenameFallbackAvailable:
            downloadReport.fallbackAvailable,

          filenameFallbackUsed:
            true,

          filenameNormalizationChanged:
            downloadReport.normalizationChanged,

          simulated:
            downloadError.u1Simulated ===
            true,

          simulatedFault:
            downloadError.u1SimulatedFault ||
            null,

          outputBytes:
            converted.byteLength,

          downloadAttempts:
            downloadReport.attempts,
        });

        throw downloadError;
      }
    } else {
      downloadReport.failedAttempt =
        originalAttempt.attempt.type;

      downloadReport.finalFilename =
        originalAttempt.attempt.filename;

      diagnostics.setMetadata({
        outputDownloadFinalFilename:
          downloadReport.finalFilename,

        outputDownloadFallbackUsed:
          downloadReport.fallbackUsed,

        outputDownloadFailedAttempt:
          downloadReport.failedAttempt,

        outputDownloadAttempts:
          downloadReport.attempts.map(
            item => ({
              ...item,
            })
          ),
      });

      logU1OutputDownloadReportSafe(
        downloadReport,
        currentSettings.debugReport !== false
      );

      throw createU1OutputDownloadError(
        originalAttempt.error,
        downloadReport
      );
    }

    diagnostics.setMetadata({
      outputDownloadFinalFilename:
        downloadReport.finalFilename,

      outputDownloadFallbackUsed:
        downloadReport.fallbackUsed,

      outputDownloadForceFilename:
        downloadReport.forceFilename,

      outputDownloadFilenameForced:
        downloadReport.filenameForced,

      outputDownloadFailedAttempt:
        null,

      outputDownloadAttempts:
        downloadReport.attempts.map(
          item => ({
            ...item,
          })
        ),
    });

    diagnostics.clearOperation();

    logU1OutputDownloadReportSafe(
      downloadReport,
      currentSettings.debugReport !== false
    );
  } finally {
    if (releaseOutputUrl) {
      setTimeout(
        () =>
          URL.revokeObjectURL(
            releaseOutputUrl
          ),
        60_000
      );
    }
  }

  return downloadReport;
}
