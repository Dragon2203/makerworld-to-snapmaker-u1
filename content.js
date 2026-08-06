// MakerWorld → Snapmaker U1 content script
// Conversion is handled entirely in-browser via converter.js + JSZip (no external service needed).

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const BUTTON_ICON_PATHS = {
  ready:
    'M7 7h10l-2.7-2.7 1.4-1.4L20.8 8l-5.1 5.1-1.4-1.4L17 9H7V7Zm10 10H7l2.7 2.7-1.4 1.4L3.2 16l5.1-5.1 1.4 1.4L7 15h10v2Z',
  loading:
    'M12 3a9 9 0 1 0 8.49 6h-2.18A7 7 0 1 1 12 5c1.93 0 3.68.78 4.95 2.05L14 10h7V3l-2.63 2.63A8.96 8.96 0 0 0 12 3Z',
  success:
    'm9.2 16.2-4.4-4.4 1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10Z',
  error:
    'M12 2 1 21h22L12 2Zm0 5 6.1 12H5.9L12 7Zm-1 3v5h2v-5h-2Zm0 6.5v2h2v-2h-2Z',
};

function createButtonIconSvg(state) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.classList.add(`convert-button__icon-${state}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', BUTTON_ICON_PATHS[state]);
  path.setAttribute('fill', 'currentColor');

  svg.appendChild(path);
  return svg;
}

(() => {
  // Internal development-build switch.
  //
  // This is unrelated to Chrome's extension developer mode.
  // Keep the value identical to options.js.
  const ENABLE_U1_FAULT_SIMULATION = false;

  const SETTING_DEFAULTS = {
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
    debugReport:           true,
    deepDebugReport:       false,
    smartProcessMerge:    true,
    strictProcessMerge:   false,

    u1TestFault:          'none',
  };

  let u1ModeActive       = false;
  let injectedSlide      = null;
  let isInjecting        = false;
  let isConverting       = false;
  let _bypassInterceptor = false;
  let _btnState          = null;    // currently rendered DOM state
  let _resultState       = 'ready'; // persistent state for the current page interaction
  let _dropdownUiBusy    = false;
  let _errorDropdownState = null;
  let _lastErrorReportText = '';

  // MakerWorld keeps the selected download action in its current React state
  // even after we restore the persisted localStorage preference.
  //
  // Remember that 3MF was selected for the current page so repeated
  // conversions can use the main button directly without reopening the menu.
  let _makerWorld3mfSelectedForPage =
    false;

  const MAKERWORLD_ACTION_STORAGE_KEY =
    'model_operate_last_key';

  const MAKERWORLD_DOWNLOAD_3MF_ACTION =
    'download_3mf';

  const isFirefox =
    chrome.runtime.getURL('').startsWith('moz-extension://');

  // Cross-browser storage helpers:
  // Firefox uses the Promise-based browser.* namespace.
  // Chrome/Chromium uses the callback-compatible chrome.* namespace.
  async function getStorageSyncSafe(defaults) {
    try {
      if (
        typeof browser !== 'undefined' &&
        browser.storage?.sync?.get
      ) {
        const result = await browser.storage.sync.get(defaults);
        return result ?? { ...defaults };
      }

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.sync?.get
      ) {
        return await new Promise((resolve) => {
          chrome.storage.sync.get(defaults, (result) => {
            if (chrome.runtime?.lastError) {
              console.warn(
                '[U1 Extension] sync storage read failed, using defaults:',
                chrome.runtime.lastError.message
              );
              resolve({ ...defaults });
              return;
            }

            resolve(result ?? { ...defaults });
          });
        });
      }
    } catch (error) {
      console.warn(
        '[U1 Extension] sync storage read failed, using defaults:',
        error
      );
    }

    console.warn(
      '[U1 Extension] extension sync storage unavailable, using defaults'
    );

    return { ...defaults };
  }

  async function setStorageSyncSafe(values) {
    try {
      if (
        typeof browser !== 'undefined' &&
        browser.storage?.sync?.set
      ) {
        await browser.storage.sync.set(
          values
        );

        return true;
      }

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.sync?.set
      ) {
        return await new Promise(
          resolve => {
            chrome.storage.sync.set(
              values,
              () => {
                if (
                  chrome.runtime?.lastError
                ) {
                  console.warn(
                    '[U1 Extension] sync storage write failed:',
                    chrome.runtime.lastError.message
                  );

                  resolve(false);
                  return;
                }

                resolve(true);
              }
            );
          }
        );
      }
    } catch (error) {
      console.warn(
        '[U1 Extension] sync storage write failed:',
        error
      );
    }

    return false;
  }

  async function consumeU1TestFault() {
    if (
      ENABLE_U1_FAULT_SIMULATION !== true
    ) {
      return 'none';
    }

    const stored =
      await getStorageSyncSafe({
        u1TestFault:
          'none',
      });

    const selectedFault =
      String(
        stored?.u1TestFault ||
        'none'
      );

    if (selectedFault === 'none') {
      return 'none';
    }

    // Reset before running the conversion.
    //
    // Even when the simulated error is thrown immediately afterwards,
    // the following conversion starts normally.
    await setStorageSyncSafe({
      u1TestFault:
        'none',
    });

    return selectedFault;
  }

  function getMakerWorldModelId(
    pathname = location.pathname
  ) {
    return (
      String(pathname || '')
        .match(/\/models\/(\d+)(?:-|\/|$)/)?.[1] ||
      null
    );
  }

  function getMakerWorldInstanceId(
    requestUrl
  ) {
    return (
      String(requestUrl || '')
        .match(
          /\/instance\/(\d+)\/f3mf(?:[/?#]|$)/
        )?.[1] ||
      null
    );
  }

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

  async function getStorageLocalSafe(defaults) {
    try {
      if (
        typeof browser !== 'undefined' &&
        browser.storage?.local?.get
      ) {
        const result = await browser.storage.local.get(defaults);
        return result ?? { ...defaults };
      }

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.local?.get
      ) {
        return await new Promise((resolve) => {
          chrome.storage.local.get(defaults, (result) => {
            if (chrome.runtime?.lastError) {
              console.warn(
                '[U1 Extension] local storage read failed, using defaults:',
                chrome.runtime.lastError.message
              );
              resolve({ ...defaults });
              return;
            }

            resolve(result ?? { ...defaults });
          });
        });
      }
    } catch (error) {
      console.warn(
        '[U1 Extension] local storage read failed, using defaults:',
        error
      );
    }

    console.warn(
      '[U1 Extension] extension local storage unavailable, using defaults'
    );

    return { ...defaults };
  }

  // ── Styles ────────────────────────────────────────────────────────────────────
  const __u1Style = document.createElement('style');
  __u1Style.textContent = `
    @keyframes convert-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes convert-progress-sweep {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    @keyframes convert-success-pop {
      0%   { opacity: 0; transform: scale(.65); }
      70%  {             transform: scale(1.12); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes convert-error-shake {
      0%,100% { transform: translateX(0); }
      25%     { transform: translateX(-2px); }
      50%     { transform: translateX(2px); }
      75%     { transform: translateX(-1px); }
    }

    .u1-btn {
      position: relative;
      overflow: hidden;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100%;
      margin: 0;
      padding: 0;
    }
    .convert-button__progress {
      position: absolute; inset: 0; z-index: 1; pointer-events: none;
      opacity: 0; transform: translateX(-100%);
      background: linear-gradient(90deg,
        transparent 0%, rgba(255,255,255,.06) 25%,
        rgba(255,255,255,.22) 50%, rgba(255,255,255,.06) 75%, transparent 100%);
    }
    .convert-button__content {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: 29px minmax(0, 1fr) 29px;
      align-items: center;
      width: 100%;
      white-space: nowrap;
    }
    .convert-button__content::after {
      content: '';
      grid-column: 3;
      width: 29px;
      height: 20px;
    }
    .convert-button__icon {
      grid-column: 1;
      justify-self: end;
      display: grid; width: 20px; height: 20px; place-items: center;
    }
    .convert-button__label {
      grid-column: 2;
      min-width: 0;
      text-align: center;
    }
    .convert-button__icon svg { grid-area: 1 / 1; width: 20px; height: 20px; }
    .convert-button__icon-loading,
    .convert-button__icon-success,
    .convert-button__icon-error { display: none; }

    /* Converting */
    .u1-btn.is-converting .convert-button__icon-ready   { display: none; }
    .u1-btn.is-converting .convert-button__icon-loading {
      display: block; animation: convert-spin .9s linear infinite;
    }
    .u1-btn.is-converting .convert-button__progress {
      opacity: 1; animation: convert-progress-sweep 1.8s ease-in-out infinite;
    }

    /* Success */
    .u1-btn.is-success .convert-button__icon-ready   { display: none; }
    .u1-btn.is-success .convert-button__icon-success {
      display: block; animation: convert-success-pop 280ms ease-out;
    }

    /* Error */
    .u1-btn.is-error .convert-button__icon-ready { display: none; }
    .u1-btn.is-error .convert-button__icon-error {
      display: block; animation: convert-error-shake 360ms ease-in-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .convert-button__progress,
      .convert-button__icon-loading,
      .convert-button__icon-success,
      .convert-button__icon-error { animation: none !important; }
    }
  `;
  (document.head || document.documentElement).appendChild(__u1Style);

  // Inject injected.js into MAIN world (fetch interceptor)
  const script = document.createElement('script');
  script.src    = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // ── Button UI ─────────────────────────────────────────────────────────────────

  function getPrimaryButtonCandidates() {
    return Array.from(
      document.querySelectorAll(
        'span.primaryButton'
      )
    ).filter(
      candidate =>
        candidate.isConnected
    );
  }

  function isPrimaryButtonLayoutVisible(
    candidate
  ) {
    if (!candidate) {
      return false;
    }

    const rect =
      candidate.getBoundingClientRect();

    if (
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return false;
    }

    const style =
      window.getComputedStyle(
        candidate
      );

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function scorePrimaryButtonCandidate(
    candidate
  ) {
    if (
      !candidate ||
      !candidate.isConnected ||
      !isPrimaryButtonLayoutVisible(
        candidate
      )
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const rect =
      candidate.getBoundingClientRect();

    const viewportIntersection =
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left <
        window.innerWidth &&
      rect.top <
        window.innerHeight;

    const hasLabel =
      Boolean(
        candidate.querySelector(
          'span'
        )
      );

    const hasConverterUi =
      Boolean(
        candidate.querySelector(
          '.convert-button__label'
        )
      );

    let score =
      100;

    // Prefer the currently rendered responsive branch. Area is capped so an
    // unexpectedly large element cannot dominate the candidate selection.
    score +=
      Math.min(
        40,
        Math.round(
          (
            rect.width *
            rect.height
          ) / 400
        )
      );

    score +=
      viewportIntersection
        ? 20
        : 0;

    score +=
      hasLabel
        ? 10
        : 0;

    // Keep using an already initialized visible button when MakerWorld causes
    // a harmless DOM mutation. Hidden responsive copies never reach this point.
    score +=
      hasConverterUi
        ? 5
        : 0;

    return score;
  }

  function findPrimaryButtonMatch() {
    const candidates =
      getPrimaryButtonCandidates();

    let bestButton =
      null;

    let bestScore =
      Number.NEGATIVE_INFINITY;

    let visibleCandidateCount =
      0;

    for (
      const candidate of
      candidates
    ) {
      const score =
        scorePrimaryButtonCandidate(
          candidate
        );

      if (!Number.isFinite(score)) {
        continue;
      }

      visibleCandidateCount++;

      if (score > bestScore) {
        bestScore =
          score;

        bestButton =
          candidate;
      }
    }

    return {
      button:
        bestButton,

      candidateCount:
        candidates.length,

      visibleCandidateCount,

      bestScore:
        Number.isFinite(bestScore)
          ? bestScore
          : null,
    };
  }

  function findButton() {
    return findPrimaryButtonMatch()
      .button;
  }

  function restoreMakerWorldPrimaryButton(
    btn
  ) {
    const label =
      btn?.querySelector('span');

    if (
      !label ||
      !label.querySelector(
        '.convert-button__label'
      )
    ) {
      return false;
    }

    const originalText =
      label.dataset.origText ||
      'Open in Bambu Studio';

    label.classList.remove(
      'u1-btn',
      'is-converting',
      'is-success',
      'is-error'
    );

    label.replaceChildren();
    label.textContent =
      originalText;

    return true;
  }

  function cleanupInactivePrimaryButtonUIs(
    activeButton
  ) {
    for (
      const candidate of
      getPrimaryButtonCandidates()
    ) {
      if (
        candidate ===
        activeButton
      ) {
        continue;
      }

      restoreMakerWorldPrimaryButton(
        candidate
      );
    }
  }

  // One-time creation of the button structure inside MakerWorld's label span.
  // All elements are created through DOM APIs; no HTML strings are parsed.
  function ensureButtonUI(btn) {
    const label = btn.querySelector('span');
    if (!label || label.querySelector('.convert-button__label')) return;

    label.dataset.origText =
      label.textContent.trim() || 'Open in Bambu Studio';

    label.classList.add('u1-btn');
    _btnState = null;

    const progress = document.createElement('span');
    progress.className = 'convert-button__progress';
    progress.setAttribute('aria-hidden', 'true');

    const content = document.createElement('span');
    content.className = 'convert-button__content';

    const icon = document.createElement('span');
    icon.className = 'convert-button__icon';
    icon.setAttribute('aria-hidden', 'true');

    icon.append(
      createButtonIconSvg('ready'),
      createButtonIconSvg('loading'),
      createButtonIconSvg('success'),
      createButtonIconSvg('error')
    );

    const buttonLabel = document.createElement('span');
    buttonLabel.className = 'convert-button__label';
    buttonLabel.textContent = 'Convert to Snapmaker U1';

    content.append(icon, buttonLabel);
    label.replaceChildren(progress, content);
  }

  // Update the existing button through classList and textContent only.
  function setConvertButtonState(btn, state) {
    const label =
      btn?.querySelector('span');

    if (!label) return;

    const labelEl =
      label.querySelector(
        '.convert-button__label'
      );

    const expectedText =
      state === 'converting'
        ? 'Converting profile'
        : state === 'success'
          ? 'U1 profile ready'
          : state === 'error'
            ? 'Conversion failed'
            : 'Convert to Snapmaker U1';

    const expectedClassPresent =
      state === 'converting'
        ? label.classList.contains(
            'is-converting'
          )
        : state === 'success'
          ? label.classList.contains(
              'is-success'
            )
          : state === 'error'
            ? label.classList.contains(
                'is-error'
              )
            : (
                !label.classList.contains(
                  'is-converting'
                ) &&
                !label.classList.contains(
                  'is-success'
                ) &&
                !label.classList.contains(
                  'is-error'
                )
              );

    // Skip the DOM update only when both our internal state and the actual
    // rendered MakerWorld button still match. MakerWorld may rerender or
    // replace the button while selecting the 3MF action.
    if (
      _btnState === state &&
      labelEl &&
      labelEl.textContent === expectedText &&
      expectedClassPresent
    ) {
      return;
    }

    label.classList.remove(
      'is-converting',
      'is-success',
      'is-error'
    );

    switch (state) {
      case 'converting':
        label.classList.add(
          'is-converting'
        );

        if (labelEl) {
          labelEl.textContent =
            'Converting profile';
        }

        break;

      case 'success':
        label.classList.add(
          'is-success'
        );

        if (labelEl) {
          labelEl.textContent =
            'U1 profile ready';
        }

        break;

      case 'error':
        label.classList.add(
          'is-error'
        );

        if (labelEl) {
          labelEl.textContent =
            'Conversion failed';
        }

        break;

      default:
        if (labelEl) {
          labelEl.textContent =
            'Convert to Snapmaker U1';
        }
    }

    _btnState =
      state;
  }

  function resetConversionResult() {
    _resultState = 'ready';
    _lastErrorReportText = '';

    if (u1ModeActive && !isConverting) {
      updateButton();
    }
  }

  function setU1Mode(active) {
    if (!active) {
      void resetU1ErrorDropdown({
        closeDropdown: true,
      });
    }

    u1ModeActive = active;
    _resultState = 'ready';
    _lastErrorReportText = '';

    window.postMessage(
      {
        __u1SetMode:
          active,
      },
      '*'
    );

    updateButton();

    // Record the changed U1 selection and button state in the compact
    // MakerWorld UI integration report.
    scheduleU1Reconcile(0);
  }

  function updateButton() {
    const btn =
      findButton();

    if (!btn) return;

    // MakerWorld can keep hidden responsive copies of the primary action in
    // the DOM. Only the currently visible candidate may contain the U1 UI.
    cleanupInactivePrimaryButtonUIs(
      btn
    );

    const label =
      btn.querySelector('span');

    if (!label) return;

    if (u1ModeActive) {
      ensureButtonUI(
        btn
      );

      setConvertButtonState(
        btn,
        isConverting
          ? 'converting'
          : _resultState
      );
    } else {
      // Tear down our UI and restore MakerWorld's original text.
      if (
        restoreMakerWorldPrimaryButton(
          btn
        )
      ) {
        _btnState =
          null;
      }
    }
  }

  // ── Button click interception ─────────────────────────────────────────────────

  // Reset a previous success/error result when the user interacts with
  // another part of MakerWorld. No profile-specific state is stored.
  document.addEventListener('click', (e) => {
    if (
      !u1ModeActive ||
      isConverting ||
      _dropdownUiBusy ||
      _resultState === 'ready'
    ) {
      return;
    }

    if (e.target.closest('span.primaryButton')) return;
    if (e.target.closest('[data-u1-slide]')) return;
    if (e.target.closest('[data-u1-error-menu]')) return;

    const btn =
      findButton();

    const arrow =
      btn
        ? findDropdownArrow(btn)
        : null;

    // When the user clicks MakerWorld's own dropdown arrow, restore the
    // original menu synchronously and let the real click close the dropdown.
    //
    // Do not click the arrow programmatically here, otherwise the real user
    // click and our synthetic click could toggle the dropdown twice.
    if (
      arrow &&
      arrow.contains(e.target)
    ) {
      void resetU1ErrorDropdown({
        closeDropdown: false,
      });

      resetConversionResult();
      return;
    }

    void resetU1ErrorDropdown({
      closeDropdown: true,
    }).finally(() => {
      resetConversionResult();
    });
  }, true);

  // Start or repeat the conversion when the main MakerWorld button is clicked.
  document.addEventListener('click', (e) => {
    if (!u1ModeActive || _bypassInterceptor) return;

    const btn = e.target.closest('span.primaryButton');
    if (!btn) return;

    if (isConverting) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    startConversion(btn);
  }, true);

  // ── Conversion orchestration ──────────────────────────────────────────────────
  async function startConversion(btn) {
    isConverting = true;

    // Restore a previous temporary error menu, but keep MakerWorld's dropdown
    // open when the user already opened it manually.
    //
    // clickNativeDownload() can then use the existing dropdown directly,
    // avoiding the visible close → reopen → close sequence.
    await resetU1ErrorDropdown({
      closeDropdown: false,
    });

    _lastErrorReportText = '';
    setConvertButtonState(btn, 'converting');

    let activeTestFault =
      'none';

    const makerWorldModelId =
      getMakerWorldModelId();

    const diagnostics =
      createU1ConversionDiagnostics({
        browser:
          isFirefox
            ? 'Firefox'
            : 'Chrome/Chromium',

        pagePath:
          location.pathname,

        makerWorldModelId,

        pageLanguage:
          document.documentElement.lang ||
          navigator.language ||
          'unknown',
      });

    try {
      activeTestFault =
        await consumeU1TestFault();

      diagnostics.setMetadata({
        faultSimulationEnabled:
          ENABLE_U1_FAULT_SIMULATION === true,

        simulatedFault:
          activeTestFault !== 'none'
            ? activeTestFault
            : null,
      });

      // -------------------------------------------------------------------------
      // 1. Capture MakerWorld's authenticated download
      // -------------------------------------------------------------------------

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.CAPTURE_DOWNLOAD,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.CAPTURE_DOWNLOAD
        )
      );

      throwU1SimulatedFault(
        activeTestFault,
        'download-timeout',
        'Simulated MakerWorld download timeout.'
      );

      const capturedDownload =
        await triggerMakerWorldDownload();

      const blobUrl =
        typeof capturedDownload === 'string'
          ? capturedDownload
          : capturedDownload?.blobUrl;

      const makerWorldRequestUrl =
        typeof capturedDownload === 'object'
          ? capturedDownload?.requestUrl
          : '';

      const makerWorldInstanceId =
        getMakerWorldInstanceId(
          makerWorldRequestUrl
        );

      if (!blobUrl) {
        throw new Error(
          'Captured MakerWorld response did not contain a blob URL'
        );
      }

      diagnostics.setMetadata({
        capturedResponseType:
          String(blobUrl).startsWith('blob:')
            ? 'blob-url'
            : 'url',

        makerWorldInstanceId,
      });

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.CAPTURE_DOWNLOAD
      );

      // -------------------------------------------------------------------------
      // 2. Read captured MakerWorld response
      // -------------------------------------------------------------------------

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.FETCH_CAPTURED_RESPONSE,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.FETCH_CAPTURED_RESPONSE
        )
      );

      throwU1SimulatedFault(
        activeTestFault,
        'captured-response-failure',
        'Simulated captured MakerWorld response failure.'
      );

      const resp =
        await fetch(blobUrl);

      diagnostics.setOperation({
        operation:
          'fetch-captured-response',

        httpStatus:
          resp.status,

        responseOk:
          resp.ok,
      });

      if (!resp.ok) {
        throw new Error(
          `Blob fetch failed: ${resp.status}`
        );
      }

      let buffer =
        new Uint8Array(
          await resp.arrayBuffer()
        );

      diagnostics.setMetadata({
        capturedResponseBytes:
          buffer.byteLength,
      });

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.FETCH_CAPTURED_RESPONSE
      );

      // -------------------------------------------------------------------------
      // 3. Resolve MakerWorld JSON response to its CDN file when necessary
      // -------------------------------------------------------------------------

      let mwName =
        null;

      const responseIsZip =
        buffer[0] === 0x50 &&
        buffer[1] === 0x4B;

      diagnostics.setMetadata({
        capturedResponseIsZip:
          responseIsZip,
      });

      if (!responseIsZip) {
        diagnostics.startStage(
          U1_DIAGNOSTIC_STAGES.FETCH_CDN_FILE,
          getU1DiagnosticStageLabel(
            U1_DIAGNOSTIC_STAGES.FETCH_CDN_FILE
          )
        );

        throwU1SimulatedFault(
          activeTestFault,
          'cdn-download-failure',
          'Simulated MakerWorld CDN download failure.'
        );

        diagnostics.setOperation({
          operation:
            'parse-makerworld-download-response',

          responseBytes:
            buffer.byteLength,
        });

        const json =
          JSON.parse(
            new TextDecoder().decode(buffer)
          );

        mwName =
          json.name || null;

        const cdnUrl =
          json.url ||
          json.downloadUrl ||
          json.download_url ||
          json.fileUrl ||
          json.file_url ||
          json.file;

        if (!cdnUrl) {
          throw new Error(
            'No download URL in response'
          );
        }

        diagnostics.setOperation({
          operation:
            'fetch-makerworld-cdn-file',

          hasDownloadUrl:
            true,
        });

        const cdnResp =
          await fetch(cdnUrl);

        diagnostics.setOperation({
          operation:
            'fetch-makerworld-cdn-file',

          httpStatus:
            cdnResp.status,

          responseOk:
            cdnResp.ok,
        });

        if (!cdnResp.ok) {
          throw new Error(
            `CDN fetch failed: ${cdnResp.status}`
          );
        }

        buffer =
          new Uint8Array(
            await cdnResp.arrayBuffer()
          );

        diagnostics.setMetadata({
          makerWorldFileName:
            mwName,

          source3mfBytes:
            buffer.byteLength,
        });

        diagnostics.completeStage(
          U1_DIAGNOSTIC_STAGES.FETCH_CDN_FILE
        );
      } else {
        diagnostics.setMetadata({
          source3mfBytes:
            buffer.byteLength,
        });
      }

      // -------------------------------------------------------------------------
      // 4. Read extension settings
      // -------------------------------------------------------------------------

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.READ_SETTINGS,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.READ_SETTINGS
        )
      );

      throwU1SimulatedFault(
        activeTestFault,
        'storage-unavailable',
        'Simulated extension storage failure.'
      );

      const currentSettings =
        await getStorageSyncSafe(
          SETTING_DEFAULTS
        );

      const useOrcaCompatibility =
        currentSettings.orcaCompatibility ===
        true;

      const selectedCustomPrinterProfileId =
        useOrcaCompatibility
          ? (
              currentSettings
                .orcaCustomPrinterProfileId ||
              U1_CUSTOM_PRINTER_STANDARD_ID
            )
          : (
              currentSettings
                .customPrinterProfileId ||
              U1_CUSTOM_PRINTER_STANDARD_ID
            );

      diagnostics.setMetadata({
        targetSlicer:
          useOrcaCompatibility
            ? 'OrcaSlicer'
            : 'Snapmaker Orca',

        selectedCustomPrinterProfileId,

        printProfileMode:
          currentSettings.printProfileMode,

        filamentPresetMode:
          currentSettings.filamentPresetMode,
      });

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.READ_SETTINGS
      );

      // -------------------------------------------------------------------------
      // 5. Load selected custom printer profile
      // -------------------------------------------------------------------------

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.LOAD_PRINTER_PROFILE,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.LOAD_PRINTER_PROFILE
        ),
        {
          selectedCustomPrinterProfileId,

          customProfileRequired:
            selectedCustomPrinterProfileId !==
            U1_CUSTOM_PRINTER_STANDARD_ID,
        }
      );

      throwU1SimulatedFault(
        activeTestFault,
        'profile-load-failure',
        'Simulated printer profile load failure.'
      );

      let customPrinterProfile =
        null;

      let customPrinterProfileMissing =
        false;

      if (
        selectedCustomPrinterProfileId !==
        U1_CUSTOM_PRINTER_STANDARD_ID
      ) {
        const localSettings =
          await getStorageLocalSafe({
            [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]:
              {},

            [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]:
              {},
          });

        const activeProfileMap =
          useOrcaCompatibility
            ? localSettings[
                U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY
              ]
            : localSettings[
                U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY
              ];

        customPrinterProfile =
          activeProfileMap?.[
            selectedCustomPrinterProfileId
          ] || null;

        if (!customPrinterProfile) {
          customPrinterProfileMissing =
            true;

          console.warn(
            '[U1 Extension] Selected custom printer profile was not found in local storage:',
            selectedCustomPrinterProfileId
          );
        }
      }

      diagnostics.setMetadata({
        customPrinterProfileLoaded:
          Boolean(customPrinterProfile),

        customPrinterProfileMissing,
      });

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.LOAD_PRINTER_PROFILE
      );

      // -------------------------------------------------------------------------
      // 6. Convert the 3MF
      // -------------------------------------------------------------------------

      const converted =
        await convertToU1(
          buffer,
          {
            ...currentSettings,

            customPrinterProfile,
            customPrinterProfileMissing,
            selectedCustomPrinterProfileId,

            u1TestFault:
              activeTestFault,

            u1Diagnostics:
              diagnostics,
          }
        );
        
      // -------------------------------------------------------------------------
      // 7. Start converted file download
      // -------------------------------------------------------------------------

      const slug =
        location.pathname.match(
          /\/models\/\d+-(.+)/
        )?.[1] || 'model';

      const baseName =
        (
          mwName ||
          (
            slug.replace(/-/g, '_') +
            '.3mf'
          )
        ).replace(/\.3mf$/i, '');

      const outName =
        baseName + '-U1.3mf';

      const filenameFallback =
        createU1DownloadFilenameFallback(
          outName
        );

      const downloadReport = {
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

        failedAttempt:
          null,

        success:
          false,

        attempts:
          [],
      };

      diagnostics.setMetadata({
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

        outputDownloadAttempts:
          [],
      });

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD
        ),
        {
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
            browser.runtime.sendMessage({
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
                chrome.runtime.sendMessage(
                  {
                    type:
                      'u1_download',

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

          filename,

          result:
            'running',

          error:
            null,

          downloadId:
            null,
        };

        downloadReport.attempts.push(
          attempt
        );

        diagnostics.setOperation({
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

          outputBytes:
            converted.byteLength,
        });

        try {
          const response =
            await attemptOutputDownload(
              filename
            );

          if (!response?.ok) {
            throw new Error(
              response?.error ||
              'Download could not be started'
            );
          }

          attempt.result =
            'ok';

          attempt.downloadId =
            response.downloadId ??
            null;

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
          diagnostics.setMetadata({
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
        const originalAttempt =
          await runOutputDownloadAttempt(
            'original',
            downloadReport.originalFilename
          );

        if (originalAttempt.ok) {
          downloadReport.success =
            true;

          downloadReport.finalFilename =
            downloadReport.originalFilename;
        } else if (
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
            downloadReport.failedAttempt =
              'normalized-fallback';

            downloadReport.finalFilename =
              downloadReport.fallbackFilename;

            diagnostics.setMetadata({
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
            'original';

          downloadReport.finalFilename =
            downloadReport.originalFilename;

          diagnostics.setMetadata({
            outputDownloadFinalFilename:
              downloadReport.finalFilename,

            outputDownloadFallbackUsed:
              false,

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

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD
      );

      diagnostics.startStage(
        U1_DIAGNOSTIC_STAGES.FINISHED,
        getU1DiagnosticStageLabel(
          U1_DIAGNOSTIC_STAGES.FINISHED
        )
      );

      diagnostics.completeStage(
        U1_DIAGNOSTIC_STAGES.FINISHED
      );

      diagnostics.finish();

      _resultState =
        'success';

      setConvertButtonState(
        btn,
        _resultState
      );
    } catch (err) {
      const failedStage =
        err?.stage ||
        diagnostics.currentStage ||
        'conversion';

      const stageDefaults =
        getU1StageErrorDefaults(
          failedStage
        );

      const normalizedError =
        prepareU1ErrorForReport(
          err,
          {
            diagnostics,

            ...stageDefaults,

            stage:
              failedStage,

            context: {
              pagePath:
                location.pathname,

              browser:
                isFirefox
                  ? 'Firefox'
                  : 'Chrome/Chromium',
            },
          }
        );

      logU1ConversionError(
        normalizedError,
        diagnostics
      );

      try {
        _lastErrorReportText =
          buildU1ErrorReportText(
            normalizedError,
            diagnostics
          );
      } catch (reportError) {
        _lastErrorReportText =
          '';

        console.warn(
          '[U1 Extension] Could not build the copy-ready error report:',
          reportError
        );
      }

      _resultState =
        'error';

      setConvertButtonState(
        btn,
        _resultState
      );

      try {
        await showU1ErrorDropdown(
          normalizedError,
          diagnostics
        );
      } catch (dropdownError) {
        console.warn(
          '[U1 Extension] Could not display the error dropdown:',
          dropdownError
        );
      }
    } finally {
      isConverting =
        false;

      _bypassInterceptor =
        false;

      // MakerWorld may replace or rerender the primary button while its own
      // download request is running. MutationObserver updates are intentionally
      // ignored during conversion, so enforce the final U1 state once more now.
      updateButton();
    }
  }

  // ── Trigger MakerWorld's own authenticated download ───────────────────────────
  function triggerMakerWorldDownload() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        window.postMessage({ __u1CancelCapture: true }, '*');
        reject(new Error('Download timed out — try again'));
      }, 30000);

      function onFile(e) {
        clearTimeout(timer);
        cleanup();

        const detail =
          e.detail;

        if (
          typeof detail === 'string'
        ) {
          try {
            const parsed =
              JSON.parse(detail);

            if (
              parsed &&
              typeof parsed === 'object'
            ) {
              resolve({
                blobUrl:
                  parsed.blobUrl || '',

                requestUrl:
                  parsed.requestUrl || '',
              });

              return;
            }
          } catch {
            // Older injected.js versions supplied the blob URL directly.
          }
        }

        resolve({
          blobUrl:
            String(detail || ''),

          requestUrl:
            '',
        });
      }

      function onErr(e) {
        clearTimeout(timer);
        cleanup();

        reject(
          new Error(
            `Download error: ${e.detail}`
          )
        );
      }
      
      function cleanup() {
        window.removeEventListener('__u1_3mf',     onFile);
        window.removeEventListener('__u1_3mf_err', onErr);
      }

      window.addEventListener('__u1_3mf',     onFile);
      window.addEventListener('__u1_3mf_err', onErr);
      window.postMessage({ __u1StartCapture: true }, '*');

      setTimeout(() => {
        clickNativeDownload().catch((err) => {
          clearTimeout(timer);
          cleanup();
          window.postMessage({ __u1CancelCapture: true }, '*');
          reject(err);
        });
      }, 100);
    });
  }

  // The ▼ chevron button has an SVG icon and no meaningful text.
  // Content elements (descriptions, labels) have text but no SVG, or are large.
  function findDropdownArrow(btn) {
    const isChevron = el => el && el !== btn && !el.contains(btn) &&
      !!el.querySelector('svg') && el.textContent.trim().length < 5;

    // Check direct siblings of btn
    for (let s = btn.nextElementSibling; s; s = s.nextElementSibling) {
      if (isChevron(s)) return s;
    }
    // Check other children of btn's parent
    if (btn.parentElement) {
      for (const c of btn.parentElement.children) {
        if (isChevron(c)) return c;
      }
      // Check siblings of btn's parent (one level up)
      for (let s = btn.parentElement.nextElementSibling; s; s = s.nextElementSibling) {
        if (isChevron(s)) return s;
        for (const c of s.children) { if (isChevron(c)) return c; }
      }
    }
    return null;
  }

  function findVisibleMakerWorldDropdown() {
    // First try the known MakerWorld / Material UI popup containers.
    const knownPopup =
      Array.from(
        document.querySelectorAll(
          [
            '.MuiPopper-root',
            '.MuiPopover-root',
            '.MuiMenu-root',
            '[role="tooltip"]',
            '[role="menu"]',
            '[role="listbox"]',
          ].join(', ')
        )
      ).find(popover => {
        if (!isVisible(popover)) return false;

        if (
          popover.hasAttribute(
            'data-u1-error-dropdown'
          )
        ) {
          return true;
        }

        const text =
          String(
            popover.textContent || ''
          );

        return /\b3mf\b/i.test(text);
      });

    if (knownPopup) {
      return knownPopup;
    }

    // Fallback for MakerWorld DOM variants whose popup container has no
    // stable Material UI class or ARIA role.
    //
    // Search only for visible 3MF elements outside the primary button so the
    // main "Download 3MF" button can never be mistaken for a dropdown item.
    const candidates =
      document.querySelectorAll(
        [
          'li',
          'button',
          'a',
          'div',
          'span',
          '[role="menuitem"]',
          '[role="option"]',
        ].join(', ')
      );

    for (const element of candidates) {
      if (!isVisible(element)) continue;

      if (
        element.closest(
          'span.primaryButton'
        )
      ) {
        continue;
      }

      if (
        !isMakerWorld3mfText(
          element.textContent
        )
      ) {
        continue;
      }

      // Prefer a real popup ancestor when one exists.
      const popup =
        element.closest(
          [
            '.MuiPopper-root',
            '.MuiPopover-root',
            '.MuiMenu-root',
            '[role="tooltip"]',
            '[role="menu"]',
            '[role="listbox"]',
          ].join(', ')
        );

      if (
        popup &&
        isVisible(popup)
      ) {
        return popup;
      }

      // Otherwise use the direct menu container around the detected item.
      const container =
        element.parentElement;

      if (
        container &&
        isVisible(container)
      ) {
        return container;
      }
    }

    return null;
  }

  function isMakerWorldDropdownOpen() {
    return Boolean(
      findVisibleMakerWorldDropdown()
    );
  }

  function dispatchMakerWorldClick(target) {
    if (!target) return;

    _bypassInterceptor = true;
    _dropdownUiBusy = true;

    try {
      target.dispatchEvent(
        new MouseEvent(
          'click',
          {
            bubbles: true,
            cancelable: true,
            view: window,
          }
        )
      );
    } finally {
      _bypassInterceptor = false;

      queueMicrotask(() => {
        _dropdownUiBusy = false;
      });
    }
  }

  async function openMakerWorldDropdown(btn) {
    const existing =
      findVisibleMakerWorldDropdown();

    if (existing) return existing;

    const arrow =
      findDropdownArrow(btn);

    if (!arrow) {
      throw new Error(
        'MakerWorld dropdown arrow not found'
      );
    }

    dispatchMakerWorldClick(arrow);

    const dropdown =
      await poll(
        findVisibleMakerWorldDropdown,
        2000
      );

    if (!dropdown) {
      throw new Error(
        'MakerWorld dropdown did not open'
      );
    }

    return dropdown;
  }

  async function closeMakerWorldDropdown(btn = findButton()) {
    if (!isMakerWorldDropdownOpen()) return;

    const arrow =
      findDropdownArrow(btn);

    if (!arrow) return;

    dispatchMakerWorldClick(arrow);

    await poll(
      () =>
        !isMakerWorldDropdownOpen()
          ? true
          : null,
      1000
    );
  }

  function getMakerWorldActionSnapshot() {
    let value = null;
    let existed = false;

    try {
      existed =
        localStorage.getItem(
          MAKERWORLD_ACTION_STORAGE_KEY
        ) !== null;

      value =
        localStorage.getItem(
          MAKERWORLD_ACTION_STORAGE_KEY
        );
    } catch (error) {
      console.warn(
        '[U1 Extension] Could not read MakerWorld action preference:',
        error
      );
    }

    return {
      existed,
      value,
    };
  }

  function restoreMakerWorldAction(snapshot) {
    if (!snapshot) return;

    try {
      if (snapshot.existed) {
        localStorage.setItem(
          MAKERWORLD_ACTION_STORAGE_KEY,
          String(snapshot.value || '')
        );
      } else {
        localStorage.removeItem(
          MAKERWORLD_ACTION_STORAGE_KEY
        );
      }
    } catch (error) {
      console.warn(
        '[U1 Extension] Could not restore MakerWorld action preference:',
        error
      );
    }
  }

  function normalizeMakerWorldMenuText(text) {
    return String(text || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function isMakerWorld3mfText(text) {
    const normalized =
      normalizeMakerWorldMenuText(text);

    return (
      /\b3mf\b/i.test(normalized) &&
      normalized.length < 60
    );
  }

  function findVisibleDownloadItem(dropdown = findVisibleMakerWorldDropdown()) {
    if (!dropdown) return null;

    const candidates =
      dropdown.querySelectorAll(
        'li, button, a, div, span, [role="menuitem"], [role="option"]'
      );

    for (const element of candidates) {
      if (!isVisible(element)) continue;
      if (!isMakerWorld3mfText(element.textContent)) continue;

      const childWithSameText =
        Array.from(element.children || [])
          .some(child =>
            isVisible(child) &&
            isMakerWorld3mfText(child.textContent)
          );

      if (!childWithSameText) {
        return element;
      }
    }

    return null;
  }

  function findMakerWorldMenuEntries(dropdown) {
    const downloadItem =
      findVisibleDownloadItem(dropdown);

    if (!downloadItem) return [];

    const container =
      downloadItem.parentElement;

    if (!container) return [];

    const entries =
      Array.from(container.children)
        .filter(isVisible);

    return entries.length >= 3
      ? entries.slice(0, 3)
      : [];
  }

  function saveMenuEntryContents(entries) {
    return entries.map(entry => ({
      entry,
      childNodes:
        Array.from(entry.childNodes)
          .map(node => node.cloneNode(true)),
      dataU1ErrorMenu:
        entry.getAttribute(
          'data-u1-error-menu'
        ),
    }));
  }

  function restoreSavedMenuEntryContents(savedEntries) {
    for (const saved of savedEntries || []) {
      const entry = saved.entry;

      if (!entry?.isConnected) continue;

      entry.replaceChildren(
        ...saved.childNodes.map(
          node => node.cloneNode(true)
        )
      );

      if (saved.dataU1ErrorMenu === null) {
        entry.removeAttribute(
          'data-u1-error-menu'
        );
      } else {
        entry.setAttribute(
          'data-u1-error-menu',
          saved.dataU1ErrorMenu
        );
      }
    }
  }

  function createErrorMenuContent(
    label,
    value,
    {
      singleLine = false,
      textColor = '',
    } = {}
  ) {
    const wrapper =
      document.createElement('div');

    wrapper.style.display =
      'flex';

    wrapper.style.flexDirection =
      'column';

    wrapper.style.gap =
      '2px';

    wrapper.style.width =
      '100%';

    wrapper.style.minWidth =
      '0';

    if (textColor) {
      wrapper.style.color =
        textColor;
    }

    const heading =
      document.createElement('span');

    heading.textContent =
      label;

    heading.style.fontSize =
      '12px';

    heading.style.fontWeight =
      '600';

    heading.style.opacity =
      '0.72';

    heading.style.whiteSpace =
      'nowrap';

    const text =
      document.createElement('span');

    text.textContent =
      value;

    text.style.lineHeight =
      '1.35';

    text.style.minWidth =
      '0';

    if (singleLine) {
      text.style.whiteSpace =
        'nowrap';

      text.style.overflow =
        'hidden';

      text.style.textOverflow =
        'ellipsis';

      text.title =
        value;
    } else {
      text.style.whiteSpace =
        'normal';
    }

    wrapper.append(
      heading,
      text
    );

    return wrapper;
  }

  async function copyU1ErrorReport() {
    if (!_lastErrorReportText) return false;

    try {
      await navigator.clipboard.writeText(
        _lastErrorReportText
      );

      return true;
    } catch {
      const textarea =
        document.createElement('textarea');

      textarea.value =
        _lastErrorReportText;

      textarea.setAttribute(
        'readonly',
        ''
      );

      textarea.style.position =
        'fixed';

      textarea.style.opacity =
        '0';

      document.body.appendChild(
        textarea
      );

      textarea.select();

      let copied = false;

      try {
        copied =
          document.execCommand('copy');
      } finally {
        textarea.remove();
      }

      return copied;
    }
  }

  async function showU1ErrorDropdown(
    error,
    diagnostics
  ) {
    const btn =
      findButton();

    if (!btn) return;

    await resetU1ErrorDropdown({
      closeDropdown: false,
    });

    // The native MakerWorld dropdown may still be playing its closing
    // animation when an early conversion error occurs.
    //
    // Never replace the contents of that closing dropdown. Otherwise
    // MakerWorld finishes the animation afterwards and immediately hides
    // the error information we just inserted.
    if (
      findVisibleMakerWorldDropdown()
    ) {
      const closedNaturally =
        await poll(
          () =>
            !isMakerWorldDropdownOpen()
              ? true
              : null,
          3500
        );

      // A manually opened dropdown may not be closing at all. In that case,
      // close it once deliberately and wait until it is really gone.
      if (
        !closedNaturally &&
        isMakerWorldDropdownOpen()
      ) {
        await closeMakerWorldDropdown(
          btn
        );

        await poll(
          () =>
            !isMakerWorldDropdownOpen()
              ? true
              : null,
          3000
        );
      }

      // Let Material UI finish removing or detaching the old popup before
      // requesting a fresh one for the error display.
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            100
          )
      );
    }

    let dropdown;

    try {
      dropdown =
        await openMakerWorldDropdown(btn);
    } catch (openError) {
      console.warn(
        '[U1 Extension] Could not open error dropdown:',
        openError
      );

      return;
    }

    const entries =
      findMakerWorldMenuEntries(dropdown);

    if (entries.length < 3) {
      console.warn(
        '[U1 Extension] MakerWorld dropdown entries could not be identified.'
      );

      return;
    }

    const code =
      String(
        error?.code ||
        U1_ERROR_CODES.UNKNOWN
      );

    const stage =
      String(
        getU1DiagnosticStageLabel(
          error?.stage ||
          diagnostics?.currentStage
        )
      );

    let suggestion =
      String(
        error?.userAction ||
        'Try the conversion again.'
      );

    // MakerWorld returns HTTP 418 when a CAPTCHA challenge must be completed.
    // Show a dedicated user-friendly instruction instead of the generic retry
    // message.
    if (
      code === 'U1-DL-001' &&
      /\b418\b/.test(
        String(
          error?.originalMessage ||
          error?.message ||
          ''
        )
      )
    ) {
      suggestion =
        'Complete the MakerWorld CAPTCHA and try again.';
    }

    const savedEntries =
      saveMenuEntryContents(entries);

    // The first native MakerWorld entry can represent the currently selected
    // action and may therefore inherit a special or invisible text color.
    // Use the color of a normal visible menu entry for all temporary U1 rows.
    const menuTextColor =
      window.getComputedStyle(
        entries[1] ||
        entries[0] ||
        dropdown
      ).color;

    const previousDropdownMarker =
      dropdown.getAttribute(
        'data-u1-error-dropdown'
      );

    dropdown.setAttribute(
      'data-u1-error-dropdown',
      '1'
    );

    const reportClickHandler =
      async event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const copied =
          await copyU1ErrorReport();

        const value =
          entries[2].querySelector(
            '[data-u1-report-value]'
          );

        if (value) {
          value.textContent =
            copied
              ? 'Error report copied'
              : 'Copy failed — use console report';
        }
      };

    entries.forEach(entry => {
      entry.setAttribute(
        'data-u1-error-menu',
        '1'
      );
    });

    entries[0].replaceChildren(
      createErrorMenuContent(
        'Error',
        `${code} · ${stage}`,
        {
          singleLine:
            true,

          textColor:
            menuTextColor,
        }
      )
    );

    entries[1].replaceChildren(
      createErrorMenuContent(
        'Suggestion',
        suggestion,
        {
          singleLine:
            true,

          textColor:
            menuTextColor,
        }
      )
    );

    const reportContent =
      createErrorMenuContent(
        'Report',
        'Click to copy the error report',
        {
          singleLine:
            true,

          textColor:
            menuTextColor,
        }
      );
    reportContent.lastElementChild
      ?.setAttribute(
        'data-u1-report-value',
        '1'
      );

    entries[2].replaceChildren(
      reportContent
    );

    entries[2].addEventListener(
      'click',
      reportClickHandler,
      true
    );

    _errorDropdownState = {
      dropdown,
      previousDropdownMarker,
      savedEntries,
      reportEntry:
        entries[2],
      reportClickHandler,
    };
  }

  async function resetU1ErrorDropdown({
    closeDropdown = false,
  } = {}) {
    const state =
      _errorDropdownState;

    _errorDropdownState =
      null;

    if (state) {
      state.reportEntry
        ?.removeEventListener(
          'click',
          state.reportClickHandler,
          true
        );

      restoreSavedMenuEntryContents(
        state.savedEntries
      );

      if (state.dropdown?.isConnected) {
        if (
          state.previousDropdownMarker ===
          null
        ) {
          state.dropdown.removeAttribute(
            'data-u1-error-dropdown'
          );
        } else {
          state.dropdown.setAttribute(
            'data-u1-error-dropdown',
            state.previousDropdownMarker
          );
        }
      }
    }

    if (closeDropdown) {
      await closeMakerWorldDropdown();
    }
  }

  async function clickNativeDownload() {
    const btn = findButton();

    if (!btn) {
      throw new Error(
        'Primary button not found'
      );
    }

    const actionSnapshot =
      getMakerWorldActionSnapshot();

    try {
      // Use the main button directly when MakerWorld was already configured
      // for 3MF before this conversion, or when this page previously selected
      // the 3MF menu item during an earlier conversion.
      //
      // The second case is important because MakerWorld keeps the action in
      // its current React state even though we restore localStorage so the
      // user's persisted preference remains unchanged after a reload.
      if (
        actionSnapshot.value ===
          MAKERWORLD_DOWNLOAD_3MF_ACTION ||
        _makerWorld3mfSelectedForPage
      ) {
        dispatchMakerWorldClick(
          btn
        );

        return;
      }

      // Reuse an already open dropdown instead of closing and reopening it.
      const dropdown =
        findVisibleMakerWorldDropdown() ||
        await openMakerWorldDropdown(
          btn
        );

      const item =
        await poll(
          () =>
            findVisibleDownloadItem(
              dropdown
            ),
          5000
        );

      if (!item) {
        throw new Error(
          'Could not find the 3MF download option'
        );
      }

      console.log(
        '[U1 Extension] clicking:',
        item.textContent
          .trim()
          .slice(0, 40)
      );

      dispatchMakerWorldClick(
        item
      );

      // MakerWorld now keeps 3MF as the current action in its in-memory page
      // state. The persisted localStorage value is still restored below.
      _makerWorld3mfSelectedForPage =
        true;

      // Give MakerWorld enough time to close the dropdown itself after the
      // 3MF menu item was selected.
      const dropdownClosedNaturally =
        await poll(
          () =>
            !isMakerWorldDropdownOpen()
              ? true
              : null,
          1000
        );

      // Synthetic clicks do not always trigger MakerWorld's own menu-closing
      // logic. Only toggle the arrow when the dropdown is still demonstrably
      // open after the waiting period.
      //
      // The additional live check prevents reopening a dropdown which closed
      // immediately after the poll timed out.
      if (
        !dropdownClosedNaturally &&
        isMakerWorldDropdownOpen()
      ) {
        await closeMakerWorldDropdown(
          btn
        );
      }
    } finally {
      restoreMakerWorldAction(
        actionSnapshot
      );
    }
  }

  function isVisible(el) {
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function poll(getter, timeout) {
    return new Promise((resolve) => {
      const found = getter();
      if (found) { resolve(found); return; }
      const deadline = Date.now() + timeout;
      const id = setInterval(() => {
        const f = getter();
        if (f || Date.now() >= deadline) { clearInterval(id); resolve(f || null); }
      }, 100);
    });
  }

  // ── MakerWorld printer-filter integration ─────────────────────────────────────
  //
  // MakerWorld uses a Swiper for the printer-filter row even when every
  // available printer fits into one line and no navigation arrows are shown.
  //
  // Detection is deliberately structural and does not depend on:
  //
  // - translated headings such as "Print Profile" or "Druckprofil"
  // - a whitelist of known MakerWorld printer names
  // - generated mw-css-* class names
  // - visible Swiper navigation arrows
  //
  // The integration is reconciled idempotently. Existing U1 elements are
  // reused and never rebuilt merely because MakerWorld caused another DOM
  // mutation.

  const U1_WINDOW_MESSAGE_SOURCE =
    'makerworld-to-snapmaker-u1';

  const U1_UI_ADAPTER_VERSION =
    2;

  const U1_RECONCILE_DELAY_MS =
    100;

  const U1_RECONCILE_RETRY_DELAY_MS =
    250;

  const U1_MAX_STARTUP_RETRIES =
    8;

  let u1ReconcileTimer =
    null;

  let u1StartupRetryCount =
    0;

  let u1SwiperRefreshSequence =
    0;

  let u1UiDebugEnabled =
    true;

  let u1MainWorldReady =
    false;

  let lastU1UiReportSignature =
    '';

  const u1SwiperRefreshResults =
    new WeakMap();

  const u1SwiperRepairResults =
    new WeakMap();

  // ── Compact UI integration report ─────────────────────────────────────────────

  function createU1UiIntegrationReport() {
    return {
      adapterVersion:
        U1_UI_ADAPTER_VERSION,

      pagePath:
        location.pathname,

      pageLanguage:
        document.documentElement.lang ||
        navigator.language ||
        'unknown',

      stages:
        [],

      summary: {
        code:
          'U1-UI-WAITING',

        result:
          'waiting',

        primaryButtonFound:
          false,

        primaryButtonCandidateCount:
          0,

        primaryButtonVisibleCandidateCount:
          0,

        primaryButtonBestScore:
          null,

        primaryButtonVisible:
          false,

        swiperWrapperCount:
          0,

        printerCandidateCount:
          0,

        printerContainerFound:
          false,

        printerContainerType:
          null,

        nativePrinterCount:
          0,

        printerLabels:
          [],

        navigationPresent:
          false,

        mainWorldReady:
          u1MainWorldReady === true,

        u1OptionBefore:
          false,

        u1OptionAction:
          'none',

        u1OptionPresent:
          false,

        u1OptionVisible:
          false,

        swiperRefreshResult:
          'not-requested',

        swiperRepairAttempted:
          false,

        swiperRepairResult:
          'not-needed',

        u1ModeActive:
          u1ModeActive === true,

        convertButtonState:
          'missing',

        retryPending:
          false,
      },
    };
  }

  function addU1UiIntegrationStage(
    report,
    stage,
    result,
    details = {}
  ) {
    report.stages.push({
      stage:
        String(stage || ''),

      result:
        String(result || ''),

      details: {
        ...details,
      },
    });
  }

  function getU1ConvertButtonState() {
    const button =
      findButton();

    if (!button) {
      return 'missing';
    }

    const label =
      button.querySelector('span');

    if (!label) {
      return 'missing-label';
    }

    const converterLabel =
      label.querySelector(
        '.convert-button__label'
      );

    if (!converterLabel) {
      return 'native';
    }

    if (
      label.classList.contains(
        'is-converting'
      )
    ) {
      return 'converting';
    }

    if (
      label.classList.contains(
        'is-success'
      )
    ) {
      return 'success';
    }

    if (
      label.classList.contains(
        'is-error'
      )
    ) {
      return 'error';
    }

    return 'ready';
  }

  function finalizeU1UiIntegrationReport(
    report
  ) {
    const summary =
      report.summary;

    summary.u1ModeActive =
      u1ModeActive === true;

    summary.mainWorldReady =
      u1MainWorldReady === true;

    summary.convertButtonState =
      getU1ConvertButtonState();

    if (!summary.primaryButtonFound) {
      if (summary.retryPending) {
        summary.code =
          'U1-UI-WAITING';

        summary.result =
          'waiting';
      } else {
        summary.code =
          'U1-UI-PRIMARY-MISSING';

        summary.result =
          'warning';
      }
    } else if (
      !summary.printerContainerFound
    ) {
      if (summary.retryPending) {
        summary.code =
          'U1-UI-WAITING';

        summary.result =
          'waiting';
      } else {
        summary.code =
          'U1-UI-PRINTER-CONTAINER-MISSING';

        summary.result =
          'warning';
      }
    } else if (
      !summary.u1OptionPresent
    ) {
      summary.code =
        'U1-UI-U1-OPTION-MISSING';

      summary.result =
        'warning';
    } else if (
      summary.swiperRefreshResult ===
      'update-failed'
    ) {
      summary.code =
        'U1-UI-SWIPER-REFRESH-FAILED';

      summary.result =
        'warning';
    } else if (
      summary.swiperRefreshResult ===
      'resize-fallback-dispatched'
    ) {
      summary.code =
        'U1-UI-SWIPER-REFRESH-FALLBACK';

      summary.result =
        summary.u1OptionVisible
          ? 'ok'
          : 'warning';
    } else if (
      summary.swiperRepairResult ===
      'repair-failed'
    ) {
      summary.code =
        'U1-UI-SWIPER-REPAIR-FAILED';

      summary.result =
        'warning';
    } else if (
      !summary.u1OptionVisible &&
      summary.swiperRepairResult ===
        'requested'
    ) {
      summary.code =
        'U1-UI-SWIPER-REPAIR-PENDING';

      summary.result =
        'waiting';
    } else if (
      !summary.u1OptionVisible
    ) {
      summary.code =
        'U1-UI-U1-OPTION-HIDDEN';

      summary.result =
        'warning';
    } else {
      summary.code =
        'U1-UI-OK';

      summary.result =
        'ok';
    }

    addU1UiIntegrationStage(
      report,
      'Finished',
      summary.result,
      {
        code:
          summary.code,
      }
    );

    return report;
  }

  function createU1UiReportSignature(
    report
  ) {
    const summary =
      report.summary;

    return JSON.stringify({
      adapterVersion:
        report.adapterVersion,

      pagePath:
        report.pagePath,

      code:
        summary.code,

      result:
        summary.result,

      primaryButtonFound:
        summary.primaryButtonFound,

      primaryButtonCandidateCount:
        summary.primaryButtonCandidateCount,

      primaryButtonVisibleCandidateCount:
        summary.primaryButtonVisibleCandidateCount,

      primaryButtonBestScore:
        summary.primaryButtonBestScore,

      primaryButtonVisible:
        summary.primaryButtonVisible,

      swiperWrapperCount:
        summary.swiperWrapperCount,

      printerCandidateCount:
        summary.printerCandidateCount,

      printerContainerFound:
        summary.printerContainerFound,

      nativePrinterCount:
        summary.nativePrinterCount,

      navigationPresent:
        summary.navigationPresent,

      mainWorldReady:
        summary.mainWorldReady,

      u1OptionAction:
        summary.u1OptionAction,

      u1OptionPresent:
        summary.u1OptionPresent,

      u1OptionVisible:
        summary.u1OptionVisible,

      swiperRefreshResult:
        summary.swiperRefreshResult,

      swiperRepairAttempted:
        summary.swiperRepairAttempted,

      swiperRepairResult:
        summary.swiperRepairResult,

      u1ModeActive:
        summary.u1ModeActive,

      convertButtonState:
        summary.convertButtonState,

      retryPending:
        summary.retryPending,
    });
  }

  function formatU1UiStageDetails(
    details
  ) {
    const entries =
      Object.entries(
        details || {}
      );

    if (!entries.length) {
      return '';
    }

    return entries
      .map(
        ([key, value]) => {
          if (Array.isArray(value)) {
            return (
              `${key}: ` +
              value.join(', ')
            );
          }

          return `${key}: ${String(value)}`;
        }
      )
      .join(' · ');
  }

  function logU1UiIntegrationReport(
    report
  ) {
    finalizeU1UiIntegrationReport(
      report
    );

    const signature =
      createU1UiReportSignature(
        report
      );

    if (
      signature ===
      lastU1UiReportSignature
    ) {
      return;
    }

    lastU1UiReportSignature =
      signature;

    const isProblem =
      report.summary.result ===
        'warning';

    // When the normal Debug Report is disabled, keep successful and temporary
    // waiting reports silent. Real UI integration warnings remain visible.
    if (
      !u1UiDebugEnabled &&
      !isProblem
    ) {
      return;
    }

    const title =
      [
        '[U1 Extension] MakerWorld UI Integration',
        `Adapter v${report.adapterVersion}`,
        report.summary.code,
      ].join(' · ');

    const openGroup =
      isProblem
        ? console.group
        : console.groupCollapsed;

    openGroup.call(
      console,
      title
    );

    console.table(
      report.stages.map(
        item => ({
          Stage:
            item.stage,

          Result:
            item.result,

          Details:
            formatU1UiStageDetails(
              item.details
            ),
        })
      )
    );

    console.log(
      'Summary',
      {
        adapterVersion:
          report.adapterVersion,

        pagePath:
          report.pagePath,

        pageLanguage:
          report.pageLanguage,

        ...report.summary,
      }
    );

    console.groupEnd();
  }

  async function initializeU1UiDebugSetting() {
    const settings =
      await getStorageSyncSafe({
        debugReport:
          true,
      });

    u1UiDebugEnabled =
      settings.debugReport !== false;
  }

  void initializeU1UiDebugSetting();

  try {
    chrome.storage.onChanged.addListener(
      (changes, areaName) => {
        if (
          areaName !== 'sync' ||
          !changes.debugReport
        ) {
          return;
        }

        u1UiDebugEnabled =
          changes.debugReport.newValue !==
          false;

        // Allow the current state to be emitted once under the new setting.
        lastU1UiReportSignature =
          '';

        scheduleU1Reconcile(0);
      }
    );
  } catch (error) {
    console.warn(
      '[U1 Extension] Could not watch Debug Report setting changes:',
      error
    );
  }

  // ── Structural printer-filter detection ───────────────────────────────────────

  function normalizePrinterFilterText(
    value
  ) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getDirectSwiperSlides(
    wrapper
  ) {
    if (!wrapper) {
      return [];
    }

    return Array.from(
      wrapper.children
    ).filter(
      child =>
        child.classList?.contains(
          'swiper-slide'
        )
    );
  }

  function getPrinterSlideLabel(
    slide
  ) {
    if (!slide) {
      return '';
    }

    return normalizePrinterFilterText(
      slide.textContent
    );
  }

  function containsVisualMedia(
    element
  ) {
    return Boolean(
      element?.querySelector(
        'img, video, picture, canvas'
      )
    );
  }

  function getLocalPanelDistance(
    element,
    target,
    maxDepth = 16
  ) {
    if (
      !element ||
      !target
    ) {
      return null;
    }

    let current =
      element.parentElement;

    for (
      let depth = 1;
      current &&
      current !== document.body &&
      depth <= maxDepth;
      depth++
    ) {
      if (current.contains(target)) {
        return depth;
      }

      current =
        current.parentElement;
    }

    return null;
  }

  function scorePrinterSwiperCandidate(
    wrapper,
    primaryButton
  ) {
    if (
      !wrapper ||
      !wrapper.isConnected
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    // Popups and menus can also contain compact text elements, but can never
    // represent the printer-filter row.
    if (
      wrapper.closest(
        [
          '.MuiPopper-root',
          '.MuiPopover-root',
          '.MuiMenu-root',
          '[role="tooltip"]',
          '[role="menu"]',
          '[role="listbox"]',
        ].join(', ')
      )
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const slides =
      getDirectSwiperSlides(
        wrapper
      );

    if (slides.length < 2) {
      return Number.NEGATIVE_INFINITY;
    }

    const panelDistance =
      getLocalPanelDistance(
        wrapper,
        primaryButton
      );

    // The real printer filter and MakerWorld's primary action button live in
    // the same local Print Files panel.
    if (panelDistance === null) {
      return Number.NEGATIVE_INFINITY;
    }

    let shortTextSlideCount =
      0;

    let mediaSlideCount =
      0;

    let emptySlideCount =
      0;

    let selectedStateCount =
      0;

    let visibleSlideCount =
      0;

    let activeSlideCount =
      0;

    let u1SlideCount =
      0;

    const labels =
      [];

    for (const slide of slides) {
      const label =
        getPrinterSlideLabel(
          slide
        );

      if (
        slide.hasAttribute(
          'data-u1-slide'
        )
      ) {
        u1SlideCount++;
        continue;
      }

      if (
        slide.classList.contains(
          'swiper-slide-visible'
        )
      ) {
        visibleSlideCount++;
      }

      if (
        slide.classList.contains(
          'swiper-slide-active'
        )
      ) {
        activeSlideCount++;
      }
      
      labels.push(label);

      if (!label) {
        emptySlideCount++;
      } else if (
        label.length <= 32
      ) {
        shortTextSlideCount++;
      }

      if (
        containsVisualMedia(
          slide
        )
      ) {
        mediaSlideCount++;
      }

      if (
        slide.classList.contains(
          'swiper-slide-active'
        ) ||
        slide.querySelector(
          '.selected'
        )
      ) {
        selectedStateCount++;
      }
    }

    // Printer filters are compact text controls. A candidate dominated by
    // thumbnails or media is a model/image carousel.
    if (
      mediaSlideCount >
      Math.max(
        1,
        Math.floor(
          slides.length / 3
        )
      )
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const requiredTextSlides =
      Math.max(
        2,
        Math.ceil(
          slides.length * 0.6
        )
      );

    if (
      shortTextSlideCount <
      requiredTextSlides
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const uniqueLabels =
      new Set(
        labels.filter(Boolean)
      );

    let score =
      0;

    // Strongest signal: proximity to MakerWorld's primary action button.
    score +=
      Math.max(
        0,
        28 -
        panelDistance * 2
      );

    score +=
      shortTextSlideCount * 3;

    score +=
      Math.min(
        uniqueLabels.size,
        12
      );

    score +=
      selectedStateCount > 0
        ? 5
        : 0;

    // Prefer the swiper that is actually visible.
    score +=
      visibleSlideCount * 6;

    // Prefer the swiper containing the active slide.
    score +=
      activeSlideCount * 12;

    // Ignore wrappers already containing our injected slide.
    score -=
      u1SlideCount * 25;

    score -=
      mediaSlideCount * 8;

    score -=
      emptySlideCount * 2;

    return score;
  }

  function findPrinterSwiperMatch(
    primaryButton
  ) {
    const wrappers =
      Array.from(
        document.querySelectorAll(
          '.swiper-wrapper'
        )
      );

    let bestWrapper =
      null;

    let bestScore =
      Number.NEGATIVE_INFINITY;

    let candidateCount =
      0;

    for (const wrapper of wrappers) {
      const score =
        scorePrinterSwiperCandidate(
          wrapper,
          primaryButton
        );

      if (!Number.isFinite(score)) {
        continue;
      }

      candidateCount++;

      if (score > bestScore) {
        bestScore =
          score;

        bestWrapper =
          wrapper;
      }
    }

    return {
      wrapper:
        bestWrapper,

      wrapperCount:
        wrappers.length,

      candidateCount,

      bestScore:
        Number.isFinite(bestScore)
          ? bestScore
          : null,
    };
  }

  function getPrinterNavigationPresent(
    wrapper
  ) {
    const swiperElement =
      wrapper?.closest('.swiper');

    const navigationRoot =
      swiperElement?.parentElement ||
      swiperElement ||
      wrapper?.parentElement;

    return Boolean(
      navigationRoot?.querySelector(
        [
          '.swiper-button-prev',
          '.swiper-button-next',
          '[class*="machine-swiper-button"]',
        ].join(', ')
      )
    );
  }

  // ── U1 slide creation and state synchronization ───────────────────────────────

  function getU1SlideInner(
    slide
  ) {
    if (!slide) {
      return null;
    }

    return (
      slide.querySelector(
        '[data-u1-printer-label]'
      ) ||
      slide.querySelector(
        ':scope > div > div'
      ) ||
      slide.lastElementChild
    );
  }

  function isU1SlideVisibleInSwiper(
    wrapper,
    slide
  ) {
    if (
      !wrapper ||
      !slide ||
      !isVisible(slide)
    ) {
      return false;
    }

    const swiperElement =
      wrapper.closest('.swiper');

    if (!swiperElement) {
      return isVisible(slide);
    }

    const slideRect =
      slide.getBoundingClientRect();

    const swiperRect =
      swiperElement.getBoundingClientRect();

    return (
      slideRect.width > 0 &&
      slideRect.height > 0 &&
      slideRect.right >
        swiperRect.left &&
      slideRect.left <
        swiperRect.right &&
      slideRect.bottom >
        swiperRect.top &&
      slideRect.top <
        swiperRect.bottom
    );
  }

  function syncU1PrinterSelection(
    wrapper
  ) {
    if (!wrapper) {
      return;
    }

    const u1Slide =
      wrapper.querySelector(
        ':scope > [data-u1-slide]'
      );

    const u1Inner =
      getU1SlideInner(
        u1Slide
      );

    if (!u1Inner) {
      return;
    }

    if (u1ModeActive) {
      for (
        const nativeSlide of
        getDirectSwiperSlides(
          wrapper
        )
      ) {
        if (
          nativeSlide ===
          u1Slide
        ) {
          continue;
        }

        nativeSlide
          .querySelectorAll(
            '.selected'
          )
          .forEach(
            selectedElement =>
              selectedElement.classList.remove(
                'selected'
              )
          );
      }

      u1Inner.classList.add(
        'selected'
      );
    } else {
      u1Inner.classList.remove(
        'selected'
      );
    }
  }

  function ensurePrinterWrapperClickHandling(
    wrapper
  ) {
    if (
      !wrapper ||
      wrapper.dataset
        .u1PrinterDelegated === '1'
    ) {
      return false;
    }

    wrapper.dataset.u1PrinterDelegated =
      '1';

    wrapper.addEventListener(
      'click',
      event => {
        const clickedU1Slide =
          event.target.closest(
            '[data-u1-slide]'
          );

        if (
          clickedU1Slide &&
          wrapper.contains(
            clickedU1Slide
          )
        ) {
          event.preventDefault();
          event.stopPropagation();

          if (!u1ModeActive) {
            setU1Mode(true);
          } else {
            updateButton();
          }

          // Resolve the current U1 element dynamically instead of retaining
          // references to an older slide that React may have removed.
          syncU1PrinterSelection(
            wrapper
          );

          return;
        }

        const clickedNativeSlide =
          event.target.closest(
            '.swiper-slide:not([data-u1-slide])'
          );

        if (
          clickedNativeSlide &&
          wrapper.contains(
            clickedNativeSlide
          ) &&
          u1ModeActive
        ) {
          // Do not block MakerWorld's own native printer-selection handler.
          setU1Mode(false);

          syncU1PrinterSelection(
            wrapper
          );
        }
      }
    );

    return true;
  }

  function requestU1MainWorldStatus() {
    window.postMessage(
      {
        source:
          U1_WINDOW_MESSAGE_SOURCE,

        action:
          'main-world-status-request',
      },
      '*'
    );
  }

  function postU1PrinterSwiperRefreshRequest(
    wrapper,
    wrapperId
  ) {
    const normalizedId =
      String(wrapperId || '');

    if (
      !wrapper ||
      !wrapper.isConnected ||
      !/^u1-[a-z0-9-]{1,80}$/i.test(
        normalizedId
      )
    ) {
      return false;
    }

    window.postMessage(
      {
        source:
          U1_WINDOW_MESSAGE_SOURCE,

        action:
          'refresh-printer-swiper',

        wrapperId:
          normalizedId,
      },
      '*'
    );

    return true;
  }

  function resendPendingU1PrinterSwiperRefreshes() {
    const pendingWrappers =
      document.querySelectorAll(
        '[data-u1-refresh-id]'
      );

    for (
      const wrapper of
      pendingWrappers
    ) {
      const wrapperId =
        String(
          wrapper.dataset.u1RefreshId ||
          ''
        );

      const refreshState =
        u1SwiperRefreshResults.get(
          wrapper
        );

      if (
        refreshState?.result !==
          'requested' ||
        refreshState.wrapperId !==
          wrapperId
      ) {
        continue;
      }

      postU1PrinterSwiperRefreshRequest(
        wrapper,
        wrapperId
      );
    }
  }

  function requestPrinterSwiperVisibilityRepair(
    wrapper
  ) {
    if (
      !wrapper ||
      !wrapper.isConnected
    ) {
      return null;
    }

    const existingState =
      u1SwiperRepairResults.get(
        wrapper
      );

    // Never repeatedly reset the user's Swiper position. One repair attempt is
    // allowed for each concrete MakerWorld printer-wrapper instance.
    if (existingState) {
      return existingState.wrapperId;
    }

    const wrapperId =
      [
        'u1',
        'repair',
        Date.now().toString(36),
        (
          ++u1SwiperRefreshSequence
        ).toString(36),
      ].join('-');

    wrapper.dataset.u1RepairId =
      wrapperId;

    u1SwiperRepairResults.set(
      wrapper,
      {
        wrapperId,

        result:
          'requested',

        details:
          {},
      }
    );

    window.postMessage(
      {
        source:
          U1_WINDOW_MESSAGE_SOURCE,

        action:
          'repair-printer-swiper-visibility',

        wrapperId,
      },
      '*'
    );

    return wrapperId;
  }


  function requestPrinterSwiperRefresh(
    wrapper
  ) {
    if (
      !wrapper ||
      !wrapper.isConnected
    ) {
      return null;
    }

    const wrapperId =
      [
        'u1',
        Date.now().toString(36),
        (
          ++u1SwiperRefreshSequence
        ).toString(36),
      ].join('-');

    wrapper.dataset.u1RefreshId =
      wrapperId;

    u1SwiperRefreshResults.set(
      wrapper,
      {
        wrapperId,

        result:
          'requested',

        details:
          {},
      }
    );

    postU1PrinterSwiperRefreshRequest(
      wrapper,
      wrapperId
    );

    return wrapperId;
  }

  function injectOrReuseU1PrinterSlide(
    wrapper
  ) {
    if (
      !wrapper ||
      isInjecting
    ) {
      return {
        slide:
          null,

        action:
          'skipped',

        reason:
          isInjecting
            ? 'injection-already-running'
            : 'wrapper-missing',

        refreshRequested:
          false,
      };
    }

    const existingSlide =
      wrapper.querySelector(
        ':scope > [data-u1-slide]'
      );

    if (existingSlide) {
      injectedSlide =
        existingSlide;

      ensurePrinterWrapperClickHandling(
        wrapper
      );

      syncU1PrinterSelection(
        wrapper
      );

      return {
        slide:
          existingSlide,

        action:
          'reused',

        reason:
          '',

        refreshRequested:
          false,
      };
    }

    const slides =
      getDirectSwiperSlides(
        wrapper
      );

    if (!slides.length) {
      return {
        slide:
          null,

        action:
          'failed',

        reason:
          'native-slides-missing',

        refreshRequested:
          false,
      };
    }

    isInjecting =
      true;

    try {
      const referenceSlide =
        slides[1] ||
        slides[0];

      const referenceOuter =
        referenceSlide.querySelector(
          ':scope > div'
        );

      const referenceInner =
        referenceOuter?.querySelector(
          ':scope > div'
        );

      if (
        !referenceOuter ||
        !referenceInner
      ) {
        return {
          slide:
            null,

          action:
            'failed',

          reason:
            'printer-slide-template-missing',

          refreshRequested:
            false,
        };
      }

      const outerClassName =
        String(
          referenceOuter.className ||
          ''
        )
          .replace(
            /\bfirst\b/g,
            ''
          )
          .trim();

      const innerClassName =
        String(
          referenceInner.className ||
          ''
        )
          .replace(
            /\bselected\b/g,
            ''
          )
          .trim();

      const slide =
        document.createElement(
          'div'
        );

      slide.className =
        'swiper-slide';

      slide.dataset.u1Slide =
        '1';

      slide.dataset.u1PrinterOption =
        '1';

      const outer =
        document.createElement(
          'div'
        );

      outer.className =
        outerClassName;

      const inner =
        document.createElement(
          'div'
        );

      inner.className =
        innerClassName;

      inner.dataset.u1PrinterLabel =
        '1';

      inner.textContent =
        'Snapmaker U1';

      outer.appendChild(
        inner
      );

      slide.appendChild(
        outer
      );

      // Keep the original integration position directly after MakerWorld's
      // first "All" entry.
      slides[0].insertAdjacentElement(
        'afterend',
        slide
      );

      injectedSlide =
        slide;

      ensurePrinterWrapperClickHandling(
        wrapper
      );

      syncU1PrinterSelection(
        wrapper
      );

      const refreshId =
        requestPrinterSwiperRefresh(
          wrapper
        );

      return {
        slide,

        action:
          'inserted',

        reason:
          '',

        refreshRequested:
          Boolean(refreshId),
      };
    } finally {
      isInjecting =
        false;
    }
  }

  // ── Main-world readiness and Swiper refresh result ─────────────────────────────

  window.addEventListener(
    'message',
    event => {
      if (
        event.source !== window ||
        !event.data ||
        event.data.source !==
          U1_WINDOW_MESSAGE_SOURCE
      ) {
        return;
      }

      if (
        event.data.action ===
          'main-world-ready'
      ) {
        const readinessChanged =
          !u1MainWorldReady;

        u1MainWorldReady =
          true;

        // A refresh request may have been sent before injected.js installed
        // its Main World listener. Resend only requests which are still
        // explicitly pending; completed refreshes are never repeated.
        resendPendingU1PrinterSwiperRefreshes();

        if (readinessChanged) {
          scheduleU1Reconcile(0);
        }

        return;
      }

      const isRefreshResult =
        event.data.action ===
          'printer-swiper-refresh-result';

      const isRepairResult =
        event.data.action ===
          'printer-swiper-repair-result';

      if (
        !isRefreshResult &&
        !isRepairResult
      ) {
        return;
      }

      const wrapperId =
        String(
          event.data.wrapperId ||
          ''
        );

      if (
        !/^u1-[a-z0-9-]{1,80}$/i.test(
          wrapperId
        )
      ) {
        return;
      }

      const markerAttribute =
        isRepairResult
          ? 'data-u1-repair-id'
          : 'data-u1-refresh-id';

      const wrapper =
        Array.from(
          document.querySelectorAll(
            `[${markerAttribute}]`
          )
        ).find(
          candidate =>
            (
              isRepairResult
                ? candidate.dataset
                    .u1RepairId
                : candidate.dataset
                    .u1RefreshId
            ) === wrapperId
        );

      if (!wrapper) {
        return;
      }

      const result =
        String(
          event.data.result ||
          'unknown'
        );

      const resultState = {
        wrapperId,

        result,

        details: {
          ...(
            event.data.details ||
            {}
          ),
        },
      };

      if (isRepairResult) {
        u1SwiperRepairResults.set(
          wrapper,
          resultState
        );

        if (
          wrapper.dataset.u1RepairId ===
          wrapperId
        ) {
          delete wrapper.dataset
            .u1RepairId;
        }
      } else {
        u1SwiperRefreshResults.set(
          wrapper,
          resultState
        );

        if (
          wrapper.dataset.u1RefreshId ===
          wrapperId
        ) {
          delete wrapper.dataset
            .u1RefreshId;
        }
      }

      // Recheck visibility and emit one changed-state report after the
      // Main World has completed its Swiper update.
      scheduleU1Reconcile(0);
    }
  );


  // ── Idempotent reconciliation ─────────────────────────────────────────────────

  function reconcileU1PrinterIntegration() {
    if (
      !location.pathname.includes(
        '/models/'
      )
    ) {
      return;
    }

    const report =
      createU1UiIntegrationReport();

    addU1UiIntegrationStage(
      report,
      'Initialize',
      'ok',
      {
        modelPage:
          true,

        adapterVersion:
          U1_UI_ADAPTER_VERSION,
      }
    );

    if (
      injectedSlide &&
      !injectedSlide.isConnected
    ) {
      injectedSlide =
        null;
    }

    const primaryButtonMatch =
      findPrimaryButtonMatch();

    const primaryButton =
      primaryButtonMatch.button;

    report.summary
      .primaryButtonFound =
      Boolean(primaryButton);

    report.summary
      .primaryButtonCandidateCount =
      primaryButtonMatch
        .candidateCount;

    report.summary
      .primaryButtonVisibleCandidateCount =
      primaryButtonMatch
        .visibleCandidateCount;

    report.summary
      .primaryButtonBestScore =
      primaryButtonMatch
        .bestScore;

    report.summary
      .primaryButtonVisible =
      Boolean(
        primaryButton &&
        isPrimaryButtonLayoutVisible(
          primaryButton
        )
      );

    addU1UiIntegrationStage(
      report,
      'Find primary button',
      primaryButton
        ? 'ok'
        : 'waiting',
      {
        found:
          Boolean(primaryButton),

        candidates:
          primaryButtonMatch
            .candidateCount,

        visibleCandidates:
          primaryButtonMatch
            .visibleCandidateCount,

        bestScore:
          primaryButtonMatch
            .bestScore ??
          'none',

        visible:
          report.summary
            .primaryButtonVisible,
      }
    );

    if (!primaryButton) {
      const retryPending =
        u1StartupRetryCount <
        U1_MAX_STARTUP_RETRIES;

      report.summary.retryPending =
        retryPending;

      if (retryPending) {
        u1StartupRetryCount++;

        scheduleU1Reconcile(
          U1_RECONCILE_RETRY_DELAY_MS
        );
      }

      logU1UiIntegrationReport(
        report
      );

      return;
    }

    const match =
      findPrinterSwiperMatch(
        primaryButton
      );

    report.summary
      .swiperWrapperCount =
      match.wrapperCount;

    report.summary
      .printerCandidateCount =
      match.candidateCount;

    report.summary
      .printerContainerFound =
      Boolean(match.wrapper);

    report.summary
      .printerContainerType =
      match.wrapper
        ? 'swiper'
        : null;

    addU1UiIntegrationStage(
      report,
      'Find printer container',
      match.wrapper
        ? 'ok'
        : 'waiting',
      {
        swiperWrappers:
          match.wrapperCount,

        candidates:
          match.candidateCount,

        bestScore:
          match.bestScore ??
          'none',
      }
    );

    if (!match.wrapper) {
      const retryPending =
        u1StartupRetryCount <
        U1_MAX_STARTUP_RETRIES;

      report.summary.retryPending =
        retryPending;

      if (retryPending) {
        u1StartupRetryCount++;

        scheduleU1Reconcile(
          U1_RECONCILE_RETRY_DELAY_MS
        );
      }

      logU1UiIntegrationReport(
        report
      );

      return;
    }

    u1StartupRetryCount =
      0;

    const wrapper =
      match.wrapper;

    const beforeSlides =
      getDirectSwiperSlides(
        wrapper
      );

    const existingU1Slides =
      wrapper.querySelectorAll(
        ':scope > [data-u1-slide]'
      );

    const labels =
      beforeSlides
        .filter(
          slide =>
            !slide.hasAttribute(
              'data-u1-slide'
            )
        )
        .map(
          getPrinterSlideLabel
        )
        .filter(Boolean);

    report.summary
      .nativePrinterCount =
      labels.length;

    report.summary
      .printerLabels =
      labels.slice(0, 20);

    report.summary
      .navigationPresent =
      getPrinterNavigationPresent(
        wrapper
      );

    report.summary
      .u1OptionBefore =
      existingU1Slides.length > 0;

    addU1UiIntegrationStage(
      report,
      'Inspect printer container',
      'ok',
      {
        nativePrinters:
          labels.length,

        navigation:
          report.summary
            .navigationPresent,

        existingU1Options:
          existingU1Slides.length,
      }
    );

    if (existingU1Slides.length > 1) {
      console.warn(
        '[U1 Extension] Multiple Snapmaker U1 printer entries detected in the active printer wrapper.'
      );
    }

    const integration =
      injectOrReuseU1PrinterSlide(
        wrapper
      );

    report.summary
      .u1OptionAction =
      integration.action;

    report.summary
      .u1OptionPresent =
      Boolean(
        integration.slide
      );

    addU1UiIntegrationStage(
      report,
      'Insert or reuse U1 option',
      integration.slide
        ? 'ok'
        : 'failed',
      {
        action:
          integration.action,

        reason:
          integration.reason ||
          'none',

        refreshRequested:
          integration.refreshRequested,
      }
    );

    if (!integration.slide) {
      logU1UiIntegrationReport(
        report
      );

      return;
    }

    injectedSlide =
      integration.slide;

    const handlerAdded =
      ensurePrinterWrapperClickHandling(
        wrapper
      );

    syncU1PrinterSelection(
      wrapper
    );

    addU1UiIntegrationStage(
      report,
      'Synchronize U1 selection',
      'ok',
      {
        modeActive:
          u1ModeActive,

        handlerAdded,
      }
    );

    const refreshState =
      u1SwiperRefreshResults.get(
        wrapper
      );

    report.summary
      .swiperRefreshResult =
      refreshState?.result ||
      (
        integration.refreshRequested
          ? 'requested'
          : 'not-requested'
      );

    addU1UiIntegrationStage(
      report,
      'Refresh printer layout',
      (
        report.summary
          .swiperRefreshResult ===
          'update-failed'
      )
        ? 'warning'
        : (
            report.summary
              .swiperRefreshResult ===
              'requested'
              ? 'pending'
              : 'ok'
          ),
      {
        result:
          report.summary
            .swiperRefreshResult,

        mainWorldReady:
          u1MainWorldReady,

        swiperFound:
          refreshState?.details
            ?.swiperFound ??
          'unknown',

        navigationUpdated:
          refreshState?.details
            ?.navigationUpdated ??
          'unknown',
      }
    );

    report.summary
      .u1OptionVisible =
      isU1SlideVisibleInSwiper(
        wrapper,
        integration.slide
      );

    addU1UiIntegrationStage(
      report,
      'Check U1 visibility',
      report.summary
        .u1OptionVisible
        ? 'ok'
        : 'warning',
      {
        visible:
          report.summary
            .u1OptionVisible,
      }
    );

    let repairState =
      u1SwiperRepairResults.get(
        wrapper
      );

    // Trigger the stronger positioning repair only after the normal Swiper
    // refresh has completed successfully and the U1 option is still outside
    // the visible viewport.
    if (
      !report.summary.u1OptionVisible &&
      report.summary
        .swiperRefreshResult !==
        'requested' &&
      !repairState
    ) {
      const repairId =
        requestPrinterSwiperVisibilityRepair(
          wrapper
        );

      if (repairId) {
        repairState =
          u1SwiperRepairResults.get(
            wrapper
          );
      }
    }

    report.summary
      .swiperRepairAttempted =
      Boolean(repairState);

    report.summary
      .swiperRepairResult =
      repairState?.result ||
      'not-needed';

    addU1UiIntegrationStage(
      report,
      'Repair printer visibility',
      !repairState
        ? 'skipped'
        : repairState.result ===
            'requested'
          ? 'pending'
          : repairState.result ===
              'repair-failed'
            ? 'warning'
            : 'ok',
      {
        attempted:
          Boolean(repairState),

        result:
          repairState?.result ||
          'not-needed',

        swiperFound:
          repairState?.details
            ?.swiperFound ??
          'unknown',

        slideToAvailable:
          repairState?.details
            ?.slideToAvailable ??
          'unknown',

        navigationUpdated:
          repairState?.details
            ?.navigationUpdated ??
          'unknown',
      }
    );

    if (u1ModeActive) {
      // updateButton() is internally idempotent and only repairs the button
      // if MakerWorld replaced or changed its DOM representation.
      updateButton();
    }

    report.summary
      .convertButtonState =
      getU1ConvertButtonState();

    addU1UiIntegrationStage(
      report,
      'Synchronize convert button',
      'ok',
      {
        state:
          report.summary
            .convertButtonState,

        u1ModeActive:
          u1ModeActive,
      }
    );

    logU1UiIntegrationReport(
      report
    );
  }

  function scheduleU1Reconcile(
    delay =
      U1_RECONCILE_DELAY_MS
  ) {
    if (
      u1ReconcileTimer !== null
    ) {
      return;
    }

    u1ReconcileTimer =
      window.setTimeout(
        () => {
          u1ReconcileTimer =
            null;

          reconcileU1PrinterIntegration();
        },
        Math.max(
          0,
          Number(delay) || 0
        )
      );
  }

  // ── DOM, SPA and responsive lifecycle ─────────────────────────────────────────

  let lastPath =
    location.pathname;

  const observerRoot =
    document.body ||
    document.documentElement;

  new MutationObserver(() => {
    if (isInjecting) {
      return;
    }

    if (
      location.pathname !==
      lastPath
    ) {
      lastPath =
        location.pathname;

      injectedSlide =
        null;

      u1StartupRetryCount =
        0;

      lastU1UiReportSignature =
        '';

      _makerWorld3mfSelectedForPage =
        false;

      // Do not reset an active conversion because of a transient React
      // rerender or route transition while the conversion is still running.
      if (!isConverting) {
        setU1Mode(false);
      }
    }

    scheduleU1Reconcile();
  }).observe(
    observerRoot,
    {
      childList:
        true,

      subtree:
        true,
    }
  );

  window.addEventListener(
    'resize',
    () => {
      scheduleU1Reconcile();
    },
    {
      passive:
        true,
    }
  );

  window.addEventListener(
    'pageshow',
    () => {
      scheduleU1Reconcile(0);
    }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState ===
        'visible'
      ) {
        scheduleU1Reconcile();
      }
    }
  );

  // Establish a two-way readiness handshake with injected.js.
  //
  // injected.js also sends an unsolicited ready notification after installing
  // its listener. Together, both directions make the startup order irrelevant.
  requestU1MainWorldStatus();

  // Initial reconciliation. MakerWorld may render the primary button and the
  // printer filter in separate React passes, so a limited startup retry is
  // used when either structure is not available yet.
  scheduleU1Reconcile(0);
})();
