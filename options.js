// Extension settings page — in-browser conversion (no external service required)
//
// Internal development-build switch.
//
// This is unrelated to Chrome's extension developer mode.
// Set it to false before creating a public release build.
const ENABLE_U1_FAULT_SIMULATION = false;

const DEFAULTS = {
  printProfileMode:      'preserve',
  forcedProfileId:       '0.20mm-standard',
  customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  orcaCustomPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  orcaCompatibility:    false,
  filamentPresetMode:    'preserve',
  forceExcludeObject:    true,
  forceBrimOff:          true,
  autoFixOrganicVariableLayer: true,
  fixMultiPlatePositioning: true,
  downloadMethod:         null, // Preserve legacy migration when no method is stored.
  forceDownloadFilename:   false,
  debugReport:           true,
  deepDebugReport:       false,
  smartProcessMerge:    true,
  strictProcessMerge:   false,

  u1TestFault:           'none',
};

let customPrinterProfiles = {};
let orcaCustomPrinterProfiles = {};
let pendingPrinterProfileFiles = [];
let availableProcessProfiles = [];

// ── Local 3MF conversion ──────────────────────────────────────────────────────

const local3mfDropZone =
  document.getElementById('local3mfDropZone');

const local3mfChooseBtn =
  document.getElementById('local3mfChooseBtn');

const local3mfFileInput =
  document.getElementById('local3mfFileInput');

const local3mfStatus =
  document.getElementById('local3mfStatus');

const local3mfCopyReportBtn =
  document.getElementById('local3mfCopyReportBtn');

let local3mfBusy = false;

// Currently available report for the last local conversion.
let local3mfReportText = '';
let local3mfReportType = null;

function setLocal3mfStatus(message, state = '') {
  if (!local3mfStatus) return;

  local3mfStatus.textContent = message;

  local3mfStatus.classList.toggle(
    'is-error',
    state === 'error'
  );

  local3mfStatus.classList.toggle(
    'is-success',
    state === 'success'
  );

  local3mfStatus.classList.toggle(
    'is-loading',
    state === 'loading'
  );
}

// ── Local 3MF report UI ───────────────────────────────────────────────────────

function setLocal3mfReport(type = null, text = '') {
  local3mfReportType = type;
  local3mfReportText = String(text || '');

  if (!local3mfCopyReportBtn) return;

  const hasReport =
    (type === 'project' || type === 'error') &&
    local3mfReportText.length > 0;

  local3mfCopyReportBtn.hidden = !hasReport;

  if (!hasReport) {
    local3mfCopyReportBtn.textContent = 'Copy Report';
    return;
  }

  local3mfCopyReportBtn.textContent =
    type === 'project'
      ? 'Copy Project Report'
      : 'Copy Error Report';
}

function setLocal3mfBusy(busy) {
  local3mfBusy = busy;

  local3mfDropZone?.classList.toggle(
    'is-busy',
    busy
  );

  if (local3mfChooseBtn) {
    local3mfChooseBtn.disabled = busy;
  }

  if (local3mfFileInput) {
    local3mfFileInput.disabled = busy;
  }
}

async function handleLocal3mfFile(file) {
  if (local3mfBusy || !file) return;

  // Clear the previous report for every new file,
  // including invalid or empty files.
  setLocal3mfReport();

  if (!/\.3mf$/i.test(file.name)) {
    setLocal3mfStatus(
      'Please select a valid .3mf file.',
      'error'
    );
    return;
  }

  if (file.size === 0) {
    setLocal3mfStatus(
      'The selected 3MF file is empty.',
      'error'
    );
    return;
  }

  setLocal3mfBusy(true);

  // Track the complete local 3MF workflow.
  // The converter will reuse this diagnostics instance.
  const localDiagnostics =
    createU1ConversionDiagnostics({
      source: 'Local 3MF file',
      filename: file.name,
      inputBytes: file.size,
      converterVersion: getConverterVersion(),
      browser:
        typeof browser !== 'undefined' &&
        typeof browser.runtime?.getBrowserInfo === 'function'
          ? 'Firefox'
          : 'Chrome / Chromium'
    });

  let local3mfStage = 'read';

  try {
    // Track local file reading.
    localDiagnostics.startStage(
      'read-local-3mf-file',
      'Read local 3MF file',
      {
        filename: file.name,
        fileSize: file.size
      }
    );

    setLocal3mfStatus(
      'Reading ' + file.name + '...'
    );

    const inputBuffer =
      await file.arrayBuffer();

    if (inputBuffer.byteLength === 0) {
      throw new Error(
        'The selected file contains no data.'
      );
    }

    localDiagnostics.setMetadata({
      inputBytes: inputBuffer.byteLength
    });

    localDiagnostics.completeStage(
      'read-local-3mf-file'
    );

    console.info(
      '[U1 Local Conversion] File loaded:',
      {
        filename: file.name,
        bytes: inputBuffer.byteLength
      }
    );

    // Load saved converter settings and custom printer profile.

    local3mfStage = 'settings';

    localDiagnostics.startStage(
      U1_DIAGNOSTIC_STAGES.READ_SETTINGS,
      getU1DiagnosticStageLabel(
        U1_DIAGNOSTIC_STAGES.READ_SETTINGS
      )
    );

    setLocal3mfStatus(
      'Loading converter settings...'
    );

    const converterOptions =
      await getLocal3mfConverterOptions();

    localDiagnostics.setMetadata({
      targetSlicer:
        converterOptions.orcaCompatibility === true
          ? 'OrcaSlicer'
          : 'Snapmaker Orca',

      selectedCustomPrinterProfileId:
        converterOptions.selectedCustomPrinterProfileId ||
        U1_CUSTOM_PRINTER_STANDARD_ID,

      customPrinterProfileMissing:
        converterOptions.customPrinterProfileMissing === true
    });

    localDiagnostics.completeStage(
      U1_DIAGNOSTIC_STAGES.READ_SETTINGS
    );

    console.info(
      '[U1 Local Conversion] Converter settings loaded:',
      {
        printProfileMode:
          converterOptions.printProfileMode,

        forcedProfileId:
          converterOptions.forcedProfileId,

        filamentPresetMode:
          converterOptions.filamentPresetMode,

        orcaCompatibility:
          converterOptions.orcaCompatibility,

        selectedCustomPrinterProfileId:
          converterOptions.selectedCustomPrinterProfileId,

        customPrinterProfileLoaded:
          Boolean(converterOptions.customPrinterProfile),

        customPrinterProfileMissing:
          converterOptions.customPrinterProfileMissing
      }
    );

    // Convert the local 3MF using the existing engine.

    local3mfStage = 'convert';

    setLocal3mfStatus(
      'Converting ' + file.name + '...',
      'loading'
    );

    const conversionStartedAt =
      performance.now();

    let localProjectReportText = '';

    const converted =
      await convertToU1(
        new Uint8Array(inputBuffer),
        {
          ...converterOptions,

          // Share diagnostics with the local conversion workflow.
          u1Diagnostics: localDiagnostics,

          onProjectReport: project => {
            localProjectReportText =
              buildU1ProjectReportText(
                project,
                {
                  source: 'Local 3MF file',
                  filename: file.name
                }
              );
          }
        }
      );

    const conversionDuration =
      performance.now() - conversionStartedAt;

    if (
      !(converted instanceof Uint8Array) ||
      converted.byteLength === 0
    ) {
      throw new Error(
        'Conversion did not return valid output data.'
      );
    }

    console.info(
      '[U1 Local Conversion] Conversion completed:',
      {
        filename: file.name,
        inputBytes: inputBuffer.byteLength,
        outputBytes: converted.byteLength,
        durationMs: Math.round(conversionDuration)
      }
    );

    // Start the converted file download automatically.

    local3mfStage = 'download';

    setLocal3mfStatus(
      'Starting download...',
      'loading'
    );

    const downloadResult =
      await downloadLocal3mf(
        converted,
        file.name,
        converterOptions,
        localDiagnostics
      );

    localDiagnostics.setMetadata({
      outputFilename:
        downloadResult.filename,

      outputBytes:
        converted.byteLength,

      downloadId:
        downloadResult.downloadId
    });

    localDiagnostics.completeStage(
      U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD
    );

    // The local conversion workflow is now complete.
    localDiagnostics.startStage(
      U1_DIAGNOSTIC_STAGES.FINISHED,
      getU1DiagnosticStageLabel(
        U1_DIAGNOSTIC_STAGES.FINISHED
      )
    );

    localDiagnostics.completeStage(
      U1_DIAGNOSTIC_STAGES.FINISHED
    );

    localDiagnostics.finish();

    console.info(
      '[U1 Local Conversion] Download started:',
      {
        filename: downloadResult.filename,
        downloadId: downloadResult.downloadId,
        configuredDownloadMethod: downloadResult.report.configuredDownloadMethod,
        downloadMethod: downloadResult.report.downloadMethod,
        status: downloadResult.report.status
      }
    );

    setLocal3mfStatus(
      'Conversion completed successfully: ' +
      downloadResult.filename +
      ' (' +
      (conversionDuration / 1000).toFixed(2) +
      ' s). ' +
      (downloadResult.report.status === 'initiated'
        ? 'Download requested. Check browser downloads for completion.'
        : 'Download accepted by the browser. Check downloads for completion.'),
      'success'
    );

    // Make the project report available only after
    // conversion and download initiation succeeded.
    if (localProjectReportText) {
      setLocal3mfReport(
        'project',
        localProjectReportText + '\n\n' +
        buildU1OutputDownloadReportText(downloadResult.report)
      );
    }

  } catch (error) {
    // Preserve detailed errors from the conversion engine.
    // Only create a new error for failures outside convertToU1().
    const isConverterError =
      isU1ConversionError(error);

    let reportError = error;

    if (!isConverterError) {
      let errorCode = U1_ERROR_CODES.UNKNOWN;
      let errorStage = localDiagnostics.currentStage;

      let userMessage =
        'The local 3MF conversion failed.';

      let userAction =
        'Try converting the file again.';

      if (local3mfStage === 'read') {
        errorCode = U1_ERROR_CODES.INPUT_INVALID;

        userMessage =
          'The selected local 3MF file could not be read.';

        userAction =
          'Check the file and try selecting it again.';
      } else if (local3mfStage === 'settings') {
        errorCode =
          U1_ERROR_CODES.STORAGE_UNAVAILABLE;

        errorStage =
          U1_DIAGNOSTIC_STAGES.READ_SETTINGS;

        userMessage =
          'The extension settings could not be loaded.';

        userAction =
          'Reload the extension settings page and try again.';
      } else if (local3mfStage === 'convert') {
        errorCode =
          U1_ERROR_CODES.PROJECT_BUILD_FAILED;

        userMessage =
          'The local 3MF conversion could not be completed.';

        userAction =
          'Copy the error report and include it when reporting the problem.';
      } else if (local3mfStage === 'download') {
        errorCode =
          U1_ERROR_CODES.OUTPUT_DOWNLOAD_FAILED;

        errorStage =
          U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD;

        userMessage =
          'The converted file was created, but its download could not be started.';

        userAction =
          'Check your browser downloads and try again.';
      }

      reportError = prepareU1ErrorForReport(
        error,
        {
          diagnostics: localDiagnostics,
          code: errorCode,
          stage: errorStage,
          userMessage,
          userAction,
          context: {
            source: 'Local 3MF file',
            filename: file.name
          }
        }
      );
    }

    // The converter already attaches its own diagnostics
    // to U1ConversionError instances.
    if (isConverterError && !reportError.diagnostics) {
      reportError.diagnostics =
        localDiagnostics.snapshot();
    }

    console.error(
      '[U1 Local Conversion] Failed:',
      {
        stage: local3mfStage,
        filename: file.name,
        error: reportError
      }
    );

    // Build the error report using the existing diagnostics.
    try {
      // Use a report-only copy so the original conversion error
      // and its diagnostics remain unchanged.
      const localReportError = Object.assign(
        Object.create(Object.getPrototypeOf(reportError)),
        reportError
      );

      const localReportDiagnostics = structuredClone(
        reportError.diagnostics ||
        localDiagnostics.snapshot()
      );

      // Adjust user-facing messages for local 3MF files only.
      // Preserve error codes, technical messages and diagnostics.
      const localUserMessage =
        'The selected local 3MF file could not be converted.';

      const localUserAction =
        'Check the local 3MF file and try converting it again.';

      const adaptLocal3mfMessage = (message, fallback) => {
        if (typeof message !== 'string') {
          return message;
        }

        if (/makerworld/i.test(message)) {
          return fallback;
        }

        return message
          .replace(
            /\bthe downloaded 3MF\b/gi,
            match =>
              match[0] === 'T'
                ? 'The selected local 3MF'
                : 'the selected local 3MF'
          )
          .replace(
            /\bthe downloaded file\b/gi,
            match =>
              match[0] === 'T'
                ? 'The selected local file'
                : 'the selected local file'
          )
          .replace(
            /\bdownloading and converting the model again\b/gi,
            match =>
              match[0] === 'D'
                ? 'Converting the local 3MF file again'
                : 'converting the local 3MF file again'
          );
      };

      localReportError.userMessage =
        adaptLocal3mfMessage(
          localReportError.userMessage,
          localUserMessage
        );

      localReportError.userAction =
        adaptLocal3mfMessage(
          localReportError.userAction,
          localUserAction
        );

      // Keep the diagnostics summary consistent with the
      // report-only error object.
      if (localReportDiagnostics.error) {
        localReportDiagnostics.error.userMessage =
          adaptLocal3mfMessage(
            localReportDiagnostics.error.userMessage,
            localUserMessage
          );

        localReportDiagnostics.error.userAction =
          adaptLocal3mfMessage(
            localReportDiagnostics.error.userAction,
            localUserAction
          );
      }

      localReportError.diagnostics =
        localReportDiagnostics;

      const errorReportText =
        buildU1ErrorReportText(
          localReportError,
          localReportDiagnostics
        );

      if (errorReportText) {
        setLocal3mfReport(
          'error',
          errorReportText
        );
      }
    } catch (reportBuildError) {
      console.error(
        '[U1 Local Conversion] Failed to build error report:',
        reportBuildError
      );

      // Keep the original conversion error visible.
      setLocal3mfReport();
    }

    const stageLabels = {
      read: 'File processing failed',
      settings: 'Loading settings failed',
      convert: 'Conversion failed',
      download: 'Download failed'
    };

    const stageLabel =
      stageLabels[local3mfStage] ||
      'Local 3MF processing failed';

    setLocal3mfStatus(
      stageLabel + ': ' +
      (error?.message || String(error)),
      'error'
    );

  } finally {
    setLocal3mfBusy(false);
  }
}

// ── Copy local 3MF report ─────────────────────────────────────────────────────

local3mfCopyReportBtn?.addEventListener(
  'click',
  async () => {
    if (!local3mfReportText) return;

    const originalLabel =
      local3mfCopyReportBtn.textContent;

    try {
      await navigator.clipboard.writeText(
        local3mfReportText
      );

      local3mfCopyReportBtn.textContent =
        'Copied!';

      setTimeout(() => {
        if (
          local3mfCopyReportBtn.textContent === 'Copied!'
        ) {
          local3mfCopyReportBtn.textContent =
            originalLabel;
        }
      }, 2000);

    } catch (error) {
      console.error(
        '[U1 Local Conversion] Could not copy report:',
        error
      );

      local3mfCopyReportBtn.textContent =
        'Copy failed';

      setTimeout(() => {
        if (
          local3mfCopyReportBtn.textContent === 'Copy failed'
        ) {
          local3mfCopyReportBtn.textContent =
            originalLabel;
        }
      }, 2000);
    }
  }
);

// Open native file picker.

local3mfChooseBtn?.addEventListener(
  'click',
  event => {
    event.stopPropagation();

    if (!local3mfBusy) {
      local3mfFileInput?.click();
    }
  }
);

// Clicking the drop zone also opens the picker.

local3mfDropZone?.addEventListener(
  'click',
  event => {
    if (
      local3mfBusy ||
      event.target === local3mfChooseBtn
    ) {
      return;
    }

    local3mfFileInput?.click();
  }
);

// Keyboard accessibility.

local3mfDropZone?.addEventListener(
  'keydown',
  event => {
    if (
      event.target !== local3mfDropZone ||
      local3mfBusy
    ) {
      return;
    }

    if (
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      local3mfFileInput?.click();
    }
  }
);

// File selected through the picker.

local3mfFileInput?.addEventListener(
  'change',
  async event => {
    const file = event.target.files?.[0];

    // Allow selecting the same file again.
    event.target.value = '';

    await handleLocal3mfFile(file);
  }
);

// Drag & drop support.

local3mfDropZone?.addEventListener(
  'dragover',
  event => {
    event.preventDefault();

    if (local3mfBusy) return;

    event.dataTransfer.dropEffect = 'copy';

    local3mfDropZone.classList.add(
      'is-dragover'
    );
  }
);

local3mfDropZone?.addEventListener(
  'dragleave',
  event => {
    if (
      !local3mfDropZone.contains(
        event.relatedTarget
      )
    ) {
      local3mfDropZone.classList.remove(
        'is-dragover'
      );
    }
  }
);

local3mfDropZone?.addEventListener(
  'drop',
  async event => {
    event.preventDefault();

    local3mfDropZone.classList.remove(
      'is-dragover'
    );

    if (local3mfBusy) return;

    const files = event.dataTransfer?.files;

    if (!files || files.length === 0) {
      return;
    }

    if (files.length > 1) {
      // Clear the previous report when multiple files are dropped.
      setLocal3mfReport();

      setLocal3mfStatus(
        'Please drop only one 3MF file at a time.',
        'error'
      );
      return;
    }

    await handleLocal3mfFile(files[0]);
  }
);

// ── Small storage helpers ─────────────────────────────────────────────────────

function getSyncStorage(defaults) {
  return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
}

function setSyncStorage(values) {
  return new Promise(resolve => chrome.storage.sync.set(values, resolve));
}

function getLocalStorage(defaults) {
  return new Promise(resolve => chrome.storage.local.get(defaults, resolve));
}

function setLocalStorage(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

// ── Local 3MF converter options ───────────────────────────────────────────────

async function getLocal3mfConverterOptions() {
  // Use the same saved settings as the MakerWorld converter.
  const settings = await getSyncStorage(DEFAULTS);
  settings.downloadMethod =
    resolveU1DownloadMethod(settings);
  settings.forceDownloadFilename =
    settings.downloadMethod === 'chrome-api-force';

  const useOrcaCompatibility =
    settings.orcaCompatibility === true;

  const selectedCustomPrinterProfileId =
    useOrcaCompatibility
      ? (
          settings.orcaCustomPrinterProfileId ||
          U1_CUSTOM_PRINTER_STANDARD_ID
        )
      : (
          settings.customPrinterProfileId ||
          U1_CUSTOM_PRINTER_STANDARD_ID
        );

  let customPrinterProfile = null;
  let customPrinterProfileMissing = false;

  if (
    selectedCustomPrinterProfileId !==
    U1_CUSTOM_PRINTER_STANDARD_ID
  ) {
    const storedProfiles = await getLocalStorage({
      [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
      [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {}
    });

    const activeProfileMap =
      useOrcaCompatibility
        ? storedProfiles[
            U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY
          ]
        : storedProfiles[
            U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY
          ];

    customPrinterProfile =
      activeProfileMap?.[
        selectedCustomPrinterProfileId
      ] || null;

    if (!customPrinterProfile) {
      customPrinterProfileMissing = true;

      console.warn(
        '[U1 Local Conversion] Selected custom printer profile not found:',
        selectedCustomPrinterProfileId
      );
    }
  }

  return {
    ...settings,

    customPrinterProfile,
    customPrinterProfileMissing,
    selectedCustomPrinterProfileId
  };
}

// ── Local 3MF download ────────────────────────────────────────────────────────

function getLocal3mfOutputFilename(inputFilename) {
  const baseName = String(inputFilename || '')
    .replace(/\.3mf$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();

  return (baseName || 'Converted') + '-U1.3mf';
}

function sendLocal3mfDownloadMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      message,
      response => {
        const runtimeError =
          chrome.runtime.lastError?.message;

        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        if (!response?.ok) {
          reject(
            new Error(
              response?.error ||
              'The browser could not start the download.'
            )
          );
          return;
        }

        resolve(response);
      }
    );
  });
}

async function downloadLocal3mf(
  converted,
  inputFilename,
  converterOptions,
  diagnostics
) {
  if (
    !(converted instanceof Uint8Array) ||
    converted.byteLength === 0
  ) {
    throw new Error(
      'Cannot download empty or invalid conversion output.'
    );
  }

  const isFirefox =
    typeof browser !== 'undefined' &&
    typeof browser.runtime?.getBrowserInfo === 'function';

  const report =
    await downloadU1Output({
      converted,
      outName:
        getLocal3mfOutputFilename(inputFilename),
      currentSettings:
        converterOptions,
      diagnostics,
      isFirefox,
      // Preserve the local Firefox callback-message pipeline.
      sendFirefoxDownload:
        sendLocal3mfDownloadMessage,
    });

  const acceptedAttempt =
    report.attempts.find(
      attempt => attempt.result === 'accepted'
    );

  return {
    filename:
      report.finalFilename,
    downloadId:
      acceptedAttempt?.downloadId ?? null,
    report,
  };
}

function setStatus(text, isError = false) {
  const status = document.getElementById('saveStatus');
  if (!status) return;

  status.textContent = text;
  status.style.color = isError ? '#ff7675' : '#4caf50';

  if (text) {
    setTimeout(() => {
      status.textContent = '';
      status.style.color = '#4caf50';
    }, 3000);
  }
}

// ── Print profile section ─────────────────────────────────────────────

async function loadProfiles() {
  const loading = document.getElementById('profilesLoading');
  const select = document.getElementById('forcedProfileId');

  try {
    availableProcessProfiles = await fetch(
      chrome.runtime.getURL('assets/profiles.json')
    ).then(r => r.json());

    loading.style.display = 'none';
    select.style.display = 'block';
  } catch (err) {
    availableProcessProfiles = [];
    loading.textContent = 'Could not load profiles.';
    console.error('[U1 options] profile load failed:', err);
  }
}

function getSelectedTargetNozzle() {
  const orcaCompatibility =
    document.getElementById('orcaCompatibility')?.checked === true;

  const profileMap = orcaCompatibility
    ? orcaCustomPrinterProfiles
    : customPrinterProfiles;

  const selectId = orcaCompatibility
    ? 'orcaCustomPrinterProfileId'
    : 'customPrinterProfileId';

  const selectedProfileId =
    document.getElementById(selectId)?.value ||
    U1_CUSTOM_PRINTER_STANDARD_ID;

  const customProfile =
    selectedProfileId === U1_CUSTOM_PRINTER_STANDARD_ID
      ? null
      : profileMap[selectedProfileId] || null;

  return getU1TargetNozzleDiameter(customProfile);
}

function updateForcedProfileOptions(preferredProfileId = '') {
  const select = document.getElementById('forcedProfileId');
  if (!select) return;

  const targetNozzle = getSelectedTargetNozzle();
  const nozzleDiameter = targetNozzle.nozzleDiameter || '0.4';

  const matchingProfiles = availableProcessProfiles.filter(
    profile => String(profile.nozzle || '0.4') === nozzleDiameter
  );

  const previousValue = preferredProfileId || select.value;

  select.replaceChildren();

  matchingProfiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.display;
    select.appendChild(option);
  });

  if (
    previousValue &&
    matchingProfiles.some(profile => profile.id === previousValue)
  ) {
    select.value = previousValue;
    return;
  }

  const defaultProfileId = {
    '0.2': '0.10mm-standard-0.2',
    '0.4': '0.20mm-standard',
    '0.6': '0.30mm-standard-0.6',
    '0.8': '0.40mm-standard-0.8',
  }[nozzleDiameter];

  if (
    defaultProfileId &&
    matchingProfiles.some(profile => profile.id === defaultProfileId)
  ) {
    select.value = defaultProfileId;
    return;
  }

  if (matchingProfiles.length) {
    select.value = matchingProfiles[0].id;
  }
}

function updatePrintProfileUi() {
  const forceRadio = document.getElementById('printProfileModeForce');
  const select = document.getElementById('forcedProfileId');

  if (!forceRadio || !select) return;

  select.disabled = !forceRadio.checked;
}

// ── Custom printer profile section ────────────────────────────────────────────

async function loadCustomPrinterProfiles() {
  const stored = await getLocalStorage({
    [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
    [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
  });

  // Existing installations keep using the old key for Snapmaker Orca.
  customPrinterProfiles =
    stored[U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY] || {};

  orcaCustomPrinterProfiles =
    stored[U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY] || {};
}

function formatCustomPrinterProfileDate(value) {
  if (!value) return 'unknown';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString();
}

function createProfileInfoRow(labelText, valueNodeOrText) {
  const row = document.createElement('div');
  row.className = 'profile-info-row';

  const label = document.createElement('strong');
  label.textContent = labelText;

  const value = document.createElement('span');

  if (valueNodeOrText instanceof Node) {
    value.appendChild(valueNodeOrText);
  } else {
    value.textContent = String(valueNodeOrText ?? '');
  }

  row.append(label, value);
  return row;
}

function createChangedSettingsDetails(changedSettings) {
  if (!changedSettings.length) {
    return document.createTextNode('None');
  }

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent =
    `${changedSettings.length} setting${changedSettings.length === 1 ? '' : 's'}`;

  const list = document.createElement('ul');
  list.style.margin = '6px 0 0 16px';
  list.style.padding = '0';

  [...changedSettings]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .forEach((key) => {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = String(key);
      item.appendChild(code);
      list.appendChild(item);
    });

  details.append(summary, list);
  return details;
}

function renderCustomPrinterProfileInfo(profile, infoId) {
  const info = document.getElementById(infoId);
  if (!info) return;

  info.replaceChildren();

  if (!profile) {
    info.style.display = 'none';
    return;
  }

  info.style.display = 'block';

  const changedSettings =
    profile.overrideKeys?.length
      ? profile.overrideKeys
      : Object.keys(profile.overrides || {});

  info.append(
    createProfileInfoRow('Name', profile.displayName || profile.id || ''),
    createProfileInfoRow('Based on', profile.inheritedFrom || 'unknown'),
    createProfileInfoRow('Imported', formatCustomPrinterProfileDate(profile.importedAt)),
    createProfileInfoRow('Changed settings', createChangedSettingsDetails(changedSettings)),
    createProfileInfoRow('Source', 'manual import')
  );
}

function renderCustomPrinterProfileSelect({
  profileMap,
  selectId,
  deleteButtonId,
  infoId,
  savedId = U1_CUSTOM_PRINTER_STANDARD_ID,
}) {
  const select = document.getElementById(selectId);
  const deleteBtn = document.getElementById(deleteButtonId);

  if (!select) return;

  select.replaceChildren();

  const standard = document.createElement('option');
  standard.value = U1_CUSTOM_PRINTER_STANDARD_ID;
  standard.textContent = 'Standard U1 profile';
  select.appendChild(standard);

  for (const profile of buildCustomPrinterProfileSelectRows(profileMap)) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent =
      `${profile.displayName} (${profile.overrideCount} overrides)`;
    select.appendChild(option);
  }

  select.value = profileMap[savedId]
    ? savedId
    : U1_CUSTOM_PRINTER_STANDARD_ID;

  if (deleteBtn) {
    deleteBtn.disabled =
      select.value === U1_CUSTOM_PRINTER_STANDARD_ID;
  }

  renderCustomPrinterProfileInfo(
    profileMap[select.value] || null,
    infoId
  );
}

function renderBothPrinterProfileSelects(saved = {}) {
  renderCustomPrinterProfileSelect({
    profileMap: customPrinterProfiles,
    selectId: 'customPrinterProfileId',
    deleteButtonId: 'deleteCustomPrinterProfileBtn',
    infoId: 'customPrinterProfileInfo',
    savedId:
      saved.customPrinterProfileId ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  });

  renderCustomPrinterProfileSelect({
    profileMap: orcaCustomPrinterProfiles,
    selectId: 'orcaCustomPrinterProfileId',
    deleteButtonId: 'deleteOrcaCustomPrinterProfileBtn',
    infoId: 'orcaCustomPrinterProfileInfo',
    savedId:
      saved.orcaCustomPrinterProfileId ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  });
}

function updatePrinterProfileUi() {
  const enabled =
    document.getElementById('orcaCompatibility')?.checked === true;

  const cards = document.getElementById('printerProfileCards');
  const snorcaCard = document.getElementById('snorcaPrinterProfileCard');
  const orcaCard = document.getElementById('orcaPrinterProfileCard');

  if (!cards || !snorcaCard || !orcaCard) return;

  const activeCard = enabled ? orcaCard : snorcaCard;
  const inactiveCard = enabled ? snorcaCard : orcaCard;

  cards.prepend(activeCard);
  cards.append(inactiveCard);

  activeCard.classList.remove('is-inactive');
  inactiveCard.classList.add('is-inactive');

  activeCard.setAttribute('aria-disabled', 'false');
  inactiveCard.setAttribute('aria-disabled', 'true');

  activeCard.querySelectorAll('select, button').forEach(element => {
    element.disabled = false;
  });

  inactiveCard.querySelectorAll('select, button').forEach(element => {
    element.disabled = true;
  });
}

async function saveCustomPrinterProfiles() {
  await setLocalStorage({
    [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: customPrinterProfiles,
    [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: orcaCustomPrinterProfiles,
  });
}

function openPrinterProfileTargetDialog(fileList) {
  pendingPrinterProfileFiles = Array.from(fileList || []);
  if (!pendingPrinterProfileFiles.length) return;

  const dialog = document.getElementById('printerProfileTargetDialog');
  if (!dialog) return;

  dialog.showModal();
}

async function importCustomPrinterProfileFiles(fileList, target) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const targetMap =
    target === 'orca'
      ? orcaCustomPrinterProfiles
      : customPrinterProfiles;

  let imported = 0;
  const errors = [];
  let latestId = U1_CUSTOM_PRINTER_STANDARD_ID;

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const profile = normalizeCustomPrinterProfileJson(json, file.name);

      profile.sourceMode = 'manual';
      profile.targetSlicer = target === 'orca' ? 'orca' : 'snorca';

      targetMap[profile.id] = profile;
      latestId = profile.id;
      imported++;
    } catch (error) {
      errors.push(`${file.name}: ${error.message || error}`);
    }
  }

  await saveCustomPrinterProfiles();

  const currentSaved = {
    customPrinterProfileId:
      document.getElementById('customPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,

    orcaCustomPrinterProfileId:
      document.getElementById('orcaCustomPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  };

  if (imported) {
    if (target === 'orca') {
      currentSaved.orcaCustomPrinterProfileId = latestId;
    } else {
      currentSaved.customPrinterProfileId = latestId;
    }
  }

  renderBothPrinterProfileSelects(currentSaved);
  updatePrinterProfileUi();
  updateForcedProfileOptions();

  if (errors.length) {
    console.warn('[U1 options] custom printer profile import errors:', errors);
    setStatus(`Imported ${imported}, failed ${errors.length}. See console.`, true);
  } else {
    setStatus(`Imported ${imported} custom printer profile${imported === 1 ? '' : 's'} ✓`);
  }
}

async function deleteSelectedCustomPrinterProfile(target) {
  const isOrca = target === 'orca';
  const selectId = isOrca
    ? 'orcaCustomPrinterProfileId'
    : 'customPrinterProfileId';

  const select = document.getElementById(selectId);
  if (!select || select.value === U1_CUSTOM_PRINTER_STANDARD_ID) return;

  const profileMap = isOrca
    ? orcaCustomPrinterProfiles
    : customPrinterProfiles;

  delete profileMap[select.value];
  await saveCustomPrinterProfiles();

  const saved = {
    customPrinterProfileId:
      document.getElementById('customPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,

    orcaCustomPrinterProfileId:
      document.getElementById('orcaCustomPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  };

  if (isOrca) {
    saved.orcaCustomPrinterProfileId = U1_CUSTOM_PRINTER_STANDARD_ID;
  } else {
    saved.customPrinterProfileId = U1_CUSTOM_PRINTER_STANDARD_ID;
  }

  renderBothPrinterProfileSelects(saved);
  updatePrinterProfileUi();
  updateForcedProfileOptions();

  await setSyncStorage(
    isOrca
      ? { orcaCustomPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID }
      : { customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID }
  );

  setStatus('Custom printer profile deleted ✓');
}

function updateDownloadMethodHint() {
  const select =
    document.getElementById('downloadMethod');
  const descriptions = {
    'chrome-api': 'Uses the browser Downloads API. Keep this default when downloads already work correctly.',
    'chrome-api-force': 'Uses the Downloads API with the existing filename workaround. Try this for random filenames or missing .3mf extensions, including with IDM.',
    'native-html': 'Uses a native download link to avoid filename-listener conflicts, including with Free Download Manager. The suggested filename and download completion cannot be confirmed by the extension.',
  };
  document.getElementById('downloadMethodHint').textContent =
    select.disabled
    ? 'Firefox always uses its separate download pipeline; this Chromium preference does not affect it.'
    : descriptions[select.value];
}

// ── Save settings ─────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    printProfileMode:      document.getElementById('printProfileModeForce')?.checked ? 'force' : 'preserve',
    forcedProfileId:       document.getElementById('forcedProfileId')?.value || '0.20mm-standard',
    customPrinterProfileId: document.getElementById('customPrinterProfileId')?.value || U1_CUSTOM_PRINTER_STANDARD_ID,
    orcaCustomPrinterProfileId: document.getElementById('orcaCustomPrinterProfileId')?.value || U1_CUSTOM_PRINTER_STANDARD_ID,
    orcaCompatibility:    document.getElementById('orcaCompatibility')?.checked ?? false,
    filamentPresetMode:    document.getElementById('filamentPresetMode')?.value || 'preserve',
    forceExcludeObject:    document.getElementById('forceExcludeObject')?.checked ?? true,
    forceBrimOff:          document.getElementById('forceBrimOff')?.checked ?? true,
    autoFixOrganicVariableLayer: document.getElementById('autoFixOrganicVariableLayer')?.checked ?? true,
    fixMultiPlatePositioning: document.getElementById('fixMultiPlatePositioning')?.checked ?? true,
    downloadMethod:        document.getElementById('downloadMethod').value,
    debugReport:           document.getElementById('debugReport')?.checked ?? true,
    deepDebugReport:       document.getElementById('deepDebugReport')?.checked ?? false,
    smartProcessMerge:     document.getElementById('smartProcessMerge')?.checked ?? true,
    strictProcessMerge:    document.getElementById('strictProcessMerge')?.checked ?? false,
    u1TestFault:           ENABLE_U1_FAULT_SIMULATION
      ? document.getElementById('u1TestFault')?.value || 'none'
      : 'none',
  };

  // Keep the legacy key coherent for older installations sharing sync storage.
  settings.forceDownloadFilename =
    settings.downloadMethod === 'chrome-api-force';
  await setSyncStorage(settings);
  setStatus('Saved ✓');
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('importCustomPrinterProfileBtn')?.addEventListener('click', () => {
  document.getElementById('customPrinterProfileFiles')?.click();
});

document.getElementById('customPrinterProfileFiles')?.addEventListener('change', (event) => {
  openPrinterProfileTargetDialog(event.target.files);
  event.target.value = '';
});

document.getElementById('cancelPrinterProfileImportBtn')?.addEventListener('click', () => {
  pendingPrinterProfileFiles = [];
  document.getElementById('printerProfileTargetDialog')?.close();
});

document.getElementById('confirmPrinterProfileImportBtn')?.addEventListener('click', async () => {
  const target =
    document.querySelector('input[name="printerProfileTarget"]:checked')?.value ||
    'snorca';

  const files = pendingPrinterProfileFiles;
  pendingPrinterProfileFiles = [];

  document.getElementById('printerProfileTargetDialog')?.close();
  await importCustomPrinterProfileFiles(files, target);
});

document.getElementById('deleteCustomPrinterProfileBtn')?.addEventListener('click', () => {
  deleteSelectedCustomPrinterProfile('snorca');
});

document.getElementById('deleteOrcaCustomPrinterProfileBtn')?.addEventListener('click', () => {
  deleteSelectedCustomPrinterProfile('orca');
});

document.getElementById('customPrinterProfileId')?.addEventListener('change', (event) => {
  renderCustomPrinterProfileSelect({
    profileMap: customPrinterProfiles,
    selectId: 'customPrinterProfileId',
    deleteButtonId: 'deleteCustomPrinterProfileBtn',
    infoId: 'customPrinterProfileInfo',
    savedId: event.target.value,
  });

  updatePrinterProfileUi();
  updateForcedProfileOptions();
});

document.getElementById('orcaCustomPrinterProfileId')?.addEventListener('change', (event) => {
  renderCustomPrinterProfileSelect({
    profileMap: orcaCustomPrinterProfiles,
    selectId: 'orcaCustomPrinterProfileId',
    deleteButtonId: 'deleteOrcaCustomPrinterProfileBtn',
    infoId: 'orcaCustomPrinterProfileInfo',
    savedId: event.target.value,
  });
  updatePrinterProfileUi();
  updateForcedProfileOptions();
});

document.getElementById('orcaCompatibility')?.addEventListener('change', () => {
  updatePrinterProfileUi();
  updateForcedProfileOptions();
});
document.getElementById('printProfileModePreserve')?.addEventListener('change', updatePrintProfileUi);
document.getElementById('printProfileModeForce')?.addEventListener('change', updatePrintProfileUi);

(async function initOptionsPage() {
  const s = await getSyncStorage(DEFAULTS);
  const printProfileMode = s.printProfileMode || 'preserve';

  const faultSimulationSection =
    document.getElementById(
      'u1FaultSimulationSection'
    );

  const testFaultSelect =
    document.getElementById(
      'u1TestFault'
    );

  if (ENABLE_U1_FAULT_SIMULATION === true) {
    if (faultSimulationSection) {
      faultSimulationSection.style.display =
        'block';
    }

    if (testFaultSelect) {
      testFaultSelect.value =
        s.u1TestFault || 'none';

      // Unknown or removed fault ids must never remain selected.
      if (!testFaultSelect.value) {
        testFaultSelect.value =
          'none';
      }
    }
  } else {
    if (faultSimulationSection) {
      faultSimulationSection.style.display =
        'none';
    }

    // Remove a value that may remain from a local development build.
    if (
      s.u1TestFault &&
      s.u1TestFault !== 'none'
    ) {
      await setSyncStorage({
        u1TestFault:
          'none',
      });

      s.u1TestFault =
        'none';
    }
  }

  document.getElementById('printProfileModePreserve').checked =
    printProfileMode !== 'force';

  document.getElementById('printProfileModeForce').checked =
    printProfileMode === 'force';

  document.getElementById('orcaCompatibility').checked =
    s.orcaCompatibility === true;

  document.getElementById('filamentPresetMode').value =
    s.filamentPresetMode || 'preserve';

  document.getElementById('forceExcludeObject').checked =
    s.forceExcludeObject;

  document.getElementById('forceBrimOff').checked =
    s.forceBrimOff;

  document.getElementById('autoFixOrganicVariableLayer').checked =
    s.autoFixOrganicVariableLayer;

  document.getElementById('fixMultiPlatePositioning').checked =
    s.fixMultiPlatePositioning;

  const downloadMethodSelect =
    document.getElementById('downloadMethod');
  downloadMethodSelect.value =
    resolveU1DownloadMethod(s);
  downloadMethodSelect.disabled =
    chrome.runtime.getURL('').startsWith('moz-extension://');
  downloadMethodSelect.addEventListener(
    'change',
    updateDownloadMethodHint
  );
  updateDownloadMethodHint();

  document.getElementById('debugReport').checked = s.debugReport;
  document.getElementById('deepDebugReport').checked = s.deepDebugReport;
  document.getElementById('smartProcessMerge').checked = s.smartProcessMerge;
  document.getElementById('strictProcessMerge').checked = s.strictProcessMerge;

  await loadCustomPrinterProfiles();
  renderBothPrinterProfileSelects(s);
  updatePrinterProfileUi();

  await loadProfiles();
  updateForcedProfileOptions(
    s.forcedProfileId || '0.20mm-standard'
  );
  updatePrintProfileUi();
})();
