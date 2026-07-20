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
  };

  let u1ModeActive       = false;
  let injectedSlide      = null;
  let isInjecting        = false;
  let isConverting       = false;
  let _bypassInterceptor = false;
  let _btnState          = null;    // currently rendered DOM state
  let _resultState       = 'ready'; // persistent state for the current page interaction

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
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      width: 100%;
      white-space: nowrap;
    }
    .convert-button__icon {
      display: grid; flex: 0 0 20px; width: 20px; height: 20px; place-items: center;
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
      .convert-button__icon-error,
      .convert-button__dots span { animation: none !important; }
    }
  `;
  (document.head || document.documentElement).appendChild(__u1Style);

  // Inject injected.js into MAIN world (fetch interceptor)
  const script = document.createElement('script');
  script.src    = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // ── Button UI ─────────────────────────────────────────────────────────────────
  function findButton() {
    return document.querySelector('span.primaryButton');
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
    if (_btnState === state) return; // idempotency guard: same state → no DOM mutation → no MO loop
    const label   = btn?.querySelector('span');
    if (!label)   return;
    const labelEl = label.querySelector('.convert-button__label');
    label.classList.remove('is-converting', 'is-success', 'is-error');
    switch (state) {
      case 'converting':
        label.classList.add('is-converting');
        if (labelEl) labelEl.textContent = 'Converting profile';
        break;
      case 'success':
        label.classList.add('is-success');
        if (labelEl) labelEl.textContent = 'U1 profile ready';
        break;
      case 'error':
        label.classList.add('is-error');
        if (labelEl) labelEl.textContent = 'Conversion failed';
        break;
      default: // 'ready'
        if (labelEl) labelEl.textContent = 'Convert to Snapmaker U1';
    }
    _btnState = state;
  }

  function resetConversionResult() {
    _resultState = 'ready';

    if (u1ModeActive && !isConverting) {
      updateButton();
    }
  }
  
  function setU1Mode(active) {
    u1ModeActive = active;
    _resultState = 'ready';

    window.postMessage({ __u1SetMode: active }, '*');
    updateButton();
  }

  function updateButton() {
    if (isConverting) return;
    const btn = findButton();
    if (!btn) return;
    const label = btn.querySelector('span');
    if (!label) return;

    if (u1ModeActive) {
      ensureButtonUI(btn);
      setConvertButtonState(btn, _resultState);
    } else {
      // Tear down our UI and restore MakerWorld's original text
      if (label.querySelector('.convert-button__label')) {
        const orig = label.dataset.origText || 'Open in Bambu Studio';
        label.classList.remove('u1-btn', 'is-converting', 'is-success', 'is-error');
        while (label.firstChild) label.removeChild(label.firstChild);
        label.textContent = orig;
        _btnState = null;
      }
    }
  }

  // ── Button click interception ─────────────────────────────────────────────────

  // Reset a previous success/error result when the user interacts with
  // another part of MakerWorld. No profile-specific state is stored.
  document.addEventListener('click', (e) => {
    if (!u1ModeActive || isConverting || _resultState === 'ready') return;

    if (e.target.closest('span.primaryButton')) return;
    if (e.target.closest('[data-u1-slide]')) return;

    resetConversionResult();
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
    setConvertButtonState(btn, 'converting');

    try {
      // 1. Capture the .3mf from MakerWorld
      const blobUrl = await triggerMakerWorldDownload();

      const resp = await fetch(blobUrl);
      if (!resp.ok) throw new Error(`Blob fetch failed: ${resp.status}`);

      let buffer = new Uint8Array(await resp.arrayBuffer());

      // 2. Handle JSON → CDN URL (MakerWorld returns JSON with a CDN link, not raw ZIP)
      let mwName = null;

      // Read the ZIP signature directly.
      // Firefox may block TypedArray.subarray() across isolated realms
      // because it accesses the object's constructor internally.
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
        const json = JSON.parse(new TextDecoder().decode(buffer));
        mwName = json.name || null;
        const cdnUrl = json.url || json.downloadUrl || json.download_url
                    || json.fileUrl || json.file_url || json.file;
        if (!cdnUrl) throw new Error('No download URL in response');
        const cdnResp = await fetch(cdnUrl);
        if (!cdnResp.ok) throw new Error(`CDN fetch failed: ${cdnResp.status}`);
        buffer = new Uint8Array(await cdnResp.arrayBuffer());
      }

      // 3. Load current settings + filament rules, then convert in-browser
      const currentSettings = await getStorageSyncSafe(SETTING_DEFAULTS);

      let customPrinterProfile = null;
      let customPrinterProfileMissing = false;

      const useOrcaCompatibility =
        currentSettings.orcaCompatibility === true;

      const selectedCustomPrinterProfileId =
        useOrcaCompatibility
          ? (
              currentSettings.orcaCustomPrinterProfileId ||
              U1_CUSTOM_PRINTER_STANDARD_ID
            )
          : (
              currentSettings.customPrinterProfileId ||
              U1_CUSTOM_PRINTER_STANDARD_ID
            );

      if (
        selectedCustomPrinterProfileId !==
        U1_CUSTOM_PRINTER_STANDARD_ID
      ) {
        const localSettings = await getStorageLocalSafe({
          [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
          [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
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
          customPrinterProfileMissing = true;

          console.warn(
            '[U1 Extension] Selected custom printer profile was not found in local storage:',
            selectedCustomPrinterProfileId
          );
        }
      }

      const converted = await convertToU1(buffer, {
        ...currentSettings,
        customPrinterProfile,
        customPrinterProfileMissing,
        selectedCustomPrinterProfileId,
      });

      // 4. Start the converted file download.
      //
      // Chrome/Chromium sends only a Blob URL to the background script,
      // avoiding large runtime messages.
      //
      // Firefox cannot access a MakerWorld-context Blob URL from the
      // background page, so it receives the finished bytes instead.
      const slug     = location.pathname.match(/\/models\/\d+-(.+)/)?.[1] || 'model';
      const baseName = (mwName || (slug.replace(/-/g, '_') + '.3mf')).replace(/\.3mf$/i, '');
      const outName  = baseName + '-U1.3mf';

      if (isFirefox) {
        // Firefox cannot use a MakerWorld-context Blob URL in the
        // background downloads API. Send the finished bytes instead.
        const downloadData = converted.buffer.slice(
          converted.byteOffset,
          converted.byteOffset + converted.byteLength
        );

        const response = await browser.runtime.sendMessage({
          type: 'u1_download_firefox',
          data: downloadData,
          filename: outName,
        });

        if (!response?.ok) {
          throw new Error(
            response?.error || 'Firefox download could not be started'
          );
        }
      } else {
        // Chrome/Chromium uses the existing Blob URL download path.
        const outBlob = new Blob(
          [converted],
          { type: 'application/octet-stream' }
        );
        const outUrl = URL.createObjectURL(outBlob);

        try {
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: 'u1_download',
              url: outUrl,
              filename: outName
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(
                  chrome.runtime.lastError.message
                ));
                return;
              }

              if (!response?.ok) {
                reject(new Error(
                  response?.error || 'Download could not be started'
                ));
                return;
              }

              resolve(response);
            });
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(outUrl), 60_000);
        }
      }

      _resultState = 'success';
      setConvertButtonState(btn, _resultState);
    } catch (err) {
      console.error('[U1 Extension]', err);
      _resultState = 'error';
      setConvertButtonState(btn, _resultState);
    } finally {
      isConverting       = false;
      _bypassInterceptor = false;
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

      function onFile(e) { clearTimeout(timer); cleanup(); resolve(e.detail); }
      function onErr(e)  { clearTimeout(timer); cleanup(); reject(new Error(`Download error: ${e.detail}`)); }
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

  async function clickNativeDownload() {
    const btn = findButton();
    if (!btn) throw new Error('Primary button not found');

    const arrow = findDropdownArrow(btn);
    const clickTarget = arrow || btn;

    _bypassInterceptor = true;
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    _bypassInterceptor = false;

    const item = await poll(findVisibleDownloadItem, 5000);
    if (!item) {
      throw new Error('Could not find the 3MF download option');
    }
    console.log('[U1 Extension] clicking:', item.textContent.trim().slice(0, 40));
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function findVisibleDownloadItem() {
    // "3MF" is language-independent, unlike labels such as
    // "Download", "herunterladen", "scaricare" or "télécharger".
    const normalize = t => (t || '').trim().replace(/\s+/g, ' ');

    const isDownload3mf = t => {
      t = normalize(t);

      return (
        /\b3mf\b/i.test(t) &&
        t.length < 60
      );
    };

    for (const el of document.querySelectorAll(
      'li, button, a, div, span, [role="menuitem"], [role="option"]'
    )) {
      if (!isVisible(el)) continue;
      if (isDownload3mf(el.textContent)) return el;
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {
      if (!isDownload3mf(node.textContent)) continue;

      const parent = node.parentElement;

      if (parent && isVisible(parent)) {
        return parent;
      }
    }

    return null;
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

  // ── Printer-filter Swiper injection ───────────────────────────────────────────
  function findSwiper() {
    for (const h4 of document.querySelectorAll('h4')) {
      if (h4.textContent.includes('Print Profile')) {
        let el = h4.parentElement;
        while (el && el !== document.body) {
          const w = el.querySelector('.swiper-wrapper');
          if (w) return w;
          el = el.parentElement;
        }
      }
    }
    const known = new Set(['All','P1S','P1P','P2S','X1','X1 Carbon','X1E','X2D',
                           'A1','A1 mini','A2L','H2D','H2D Pro','H2C','H2S']);
    for (const w of document.querySelectorAll('.swiper-wrapper')) {
      const texts = Array.from(w.querySelectorAll('.swiper-slide')).map(s => s.textContent.trim());
      if (texts.some(t => known.has(t))) return w;
    }
    return null;
  }

  function injectU1Slide(wrapper) {
    if (isInjecting)                             return;
    if (wrapper.querySelector('[data-u1-slide]')) return;

    const slides = wrapper.querySelectorAll('.swiper-slide');
    if (!slides.length) return;

    isInjecting = true;
    try {
      const ref      = slides[1] || slides[0];
      const outerDiv = ref.querySelector(':scope > div');
      const innerDiv = outerDiv?.querySelector(':scope > div');
      const outerCls = (outerDiv?.className || '').replace(/\bfirst\b/g, '').trim();
      const innerCls = (innerDiv?.className || '').replace(/\bselected\b/g, '').trim();

      const slide = document.createElement('div');
      slide.className       = 'swiper-slide';
      slide.dataset.u1Slide = '1';

      const outer      = document.createElement('div');
      outer.className  = outerCls;
      const inner      = document.createElement('div');
      inner.className  = innerCls;
      inner.textContent = 'Snapmaker U1';
      outer.appendChild(inner);
      slide.appendChild(outer);

      slides[0].insertAdjacentElement('afterend', slide);
      injectedSlide = slide;

      slide.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.querySelectorAll('.swiper-slide:not([data-u1-slide]) div')
          .forEach(d => d.classList.remove('selected'));
        inner.classList.add('selected');
        setU1Mode(true);
      });

      if (!wrapper.dataset.u1Delegated) {
        wrapper.dataset.u1Delegated = '1';
        wrapper.addEventListener('click', (e) => {
          if (e.target.closest('[data-u1-slide]')) return;
          if (u1ModeActive) { inner.classList.remove('selected'); setU1Mode(false); }
        });
      }
    } finally {
      isInjecting = false;
    }
  }

  // ── MutationObservers ─────────────────────────────────────────────────────────
  new MutationObserver(() => {
    if (isInjecting) return;
    if (!location.pathname.includes('/models/')) return;

    const wrapper = findSwiper();
    if (wrapper) injectU1Slide(wrapper);
    if (u1ModeActive) updateButton();
  }).observe(document.body, { childList: true, subtree: true });

  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (isInjecting || location.pathname === lastPath) return;

    lastPath = location.pathname;
    injectedSlide = null;
    setU1Mode(false);

    if (!location.pathname.includes('/models/')) return;

    const wrapper = findSwiper();
    if (wrapper) injectU1Slide(wrapper);
  }).observe(document.body, { childList: true, subtree: true });
})();
