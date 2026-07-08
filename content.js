// MakerWorld → Snapmaker U1 content script
// Conversion is handled entirely in-browser via converter.js + JSZip (no external service needed).

// Inline SVGs — avoids external asset loading, safe under MV3 CSP
const SVG_READY = `<svg class="convert-button__icon-ready" viewBox="0 0 24 24" focusable="false"><path d="M7 7h10l-2.7-2.7 1.4-1.4L20.8 8l-5.1 5.1-1.4-1.4L17 9H7V7Zm10 10H7l2.7 2.7-1.4 1.4L3.2 16l5.1-5.1 1.4 1.4L7 15h10v2Z" fill="currentColor"/></svg>`;
const SVG_LOADING = `<svg class="convert-button__icon-loading" viewBox="0 0 24 24" focusable="false"><path d="M12 3a9 9 0 1 0 8.49 6h-2.18A7 7 0 1 1 12 5c1.93 0 3.68.78 4.95 2.05L14 10h7V3l-2.63 2.63A8.96 8.96 0 0 0 12 3Z" fill="currentColor"/></svg>`;
const SVG_SUCCESS = `<svg class="convert-button__icon-success" viewBox="0 0 24 24" focusable="false"><path d="m9.2 16.2-4.4-4.4 1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10Z" fill="currentColor"/></svg>`;
const SVG_ERROR   = `<svg class="convert-button__icon-error" viewBox="0 0 24 24" focusable="false"><path d="M12 2 1 21h22L12 2Zm0 5 6.1 12H5.9L12 7Zm-1 3v5h2v-5h-2Zm0 6.5v2h2v-2h-2Z" fill="currentColor"/></svg>`;

(() => {
  const SETTING_DEFAULTS = {
    printProfileMode:      'preserve',
    forcedProfileId:       '0.20mm-standard',
    customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
    filamentPresetMode:    'preserve',
    forceExcludeObject:    true,
    forceBrimOff:          true,
    autoFixOrganicVariableLayer: true,
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
  let _btnState          = null; // tracks rendered state; prevents MO→updateButton→textContent→MO loops

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
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
    }
    .convert-button__progress {
      position: absolute; inset: 0; z-index: 1; pointer-events: none;
      opacity: 0; transform: translateX(-100%);
      background: linear-gradient(90deg,
        transparent 0%, rgba(255,255,255,.06) 25%,
        rgba(255,255,255,.22) 50%, rgba(255,255,255,.06) 75%, transparent 100%);
    }
    .convert-button__content {
      position: relative; z-index: 2;
      display: inline-flex; align-items: center; justify-content: center; gap: 9px;
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

  // One-time injection of button structure into MakerWorld's inner label span.
  // After this, all state changes go through setConvertButtonState() — no innerHTML.
  function ensureButtonUI(btn) {
    const label = btn.querySelector('span');
    if (!label || label.querySelector('.convert-button__label')) return;
    label.dataset.origText = label.textContent.trim() || 'Open in Bambu Studio';
    label.classList.add('u1-btn');
    _btnState = null; // fresh injection — force next setConvertButtonState to write DOM
    label.innerHTML =
      `<span class="convert-button__progress" aria-hidden="true"></span>` +
      `<span class="convert-button__content">` +
        `<span class="convert-button__icon" aria-hidden="true">` +
          SVG_READY + SVG_LOADING + SVG_SUCCESS + SVG_ERROR +
        `</span>` +
        `<span class="convert-button__label">Convert to Snapmaker U1</span>` +
      `</span>`;
  }

  // classList + textContent only — no innerHTML after initial injection
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

  function setU1Mode(active) {
    u1ModeActive = active;
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
      setConvertButtonState(btn, 'ready');
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
  document.addEventListener('click', (e) => {
    if (!u1ModeActive || _bypassInterceptor) return;
    const btn = e.target.closest('span.primaryButton');
    if (!btn) return;
    if (isConverting) { e.preventDefault(); e.stopImmediatePropagation(); return; }
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
      let buffer = await resp.arrayBuffer();

      // 2. Handle JSON → CDN URL (MakerWorld returns JSON with a CDN link, not raw ZIP)
      let mwName = null;
      const magic = new Uint8Array(buffer, 0, 2);
      if (magic[0] !== 0x50 || magic[1] !== 0x4B) {
        const json = JSON.parse(new TextDecoder().decode(buffer));
        mwName = json.name || null;
        const cdnUrl = json.url || json.downloadUrl || json.download_url
                    || json.fileUrl || json.file_url || json.file;
        if (!cdnUrl) throw new Error('No download URL in response');
        const cdnResp = await fetch(cdnUrl);
        if (!cdnResp.ok) throw new Error(`CDN fetch failed: ${cdnResp.status}`);
        buffer = await cdnResp.arrayBuffer();
      }

      // 3. Load current settings + filament rules, then convert in-browser
      const getStorageSafe = (defaults) => new Promise(resolve => {
        try {
          if (chrome?.storage?.sync?.get) {
            chrome.storage.sync.get(defaults, resolve);
          } else {
            console.warn('[U1 Extension] chrome.storage.sync unavailable, using defaults');
            resolve(defaults);
          }
        } catch (e) {
          console.warn('[U1 Extension] storage read failed, using defaults', e);
          resolve(defaults);
        }
      });

      const getLocalStorageSafe = (defaults) => new Promise(resolve => {
        try {
          if (chrome?.storage?.local?.get) {
            chrome.storage.local.get(defaults, resolve);
          } else {
            console.warn('[U1 Extension] chrome.storage.local unavailable, using defaults');
            resolve(defaults);
          }
        } catch (e) {
          console.warn('[U1 Extension] local storage read failed, using defaults', e);
          resolve(defaults);
        }
      });

      const currentSettings = await getStorageSafe(SETTING_DEFAULTS);

      let customPrinterProfile = null;
      let customPrinterProfileMissing = false;

      const selectedCustomPrinterProfileId =
        currentSettings.customPrinterProfileId || U1_CUSTOM_PRINTER_STANDARD_ID;

      if (selectedCustomPrinterProfileId !== U1_CUSTOM_PRINTER_STANDARD_ID) {
        const localSettings = await getLocalStorageSafe({
          u1CustomPrinterProfiles: {},
        });

        customPrinterProfile =
          localSettings.u1CustomPrinterProfiles?.[selectedCustomPrinterProfileId] || null;

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

      // 4. Trigger download directly from the content script.
      // Do NOT send the full file through chrome.runtime.sendMessage:
      // Chrome messages are limited to ~64 MiB and large MakerWorld 3MFs fail.
      const slug     = location.pathname.match(/\/models\/\d+-(.+)/)?.[1] || 'model';
      const baseName = (mwName || (slug.replace(/-/g, '_') + '.3mf')).replace(/\.3mf$/i, '');
      const outName  = baseName + '-U1.3mf';

      const outBlob = new Blob([converted], { type: 'application/octet-stream' });
      const outUrl  = URL.createObjectURL(outBlob);

      try {
        chrome.runtime.sendMessage({
          type: 'u1_download',
          url: outUrl,
          filename: outName
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[U1 Extension] download message failed:', chrome.runtime.lastError.message);
            return;
          }

          if (!response?.ok) {
            console.warn('[U1 Extension] download failed:', response?.error);
          }
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(outUrl), 60_000);
      }

      setConvertButtonState(btn, 'success');
      await new Promise(r => setTimeout(r, 1250));
    } catch (err) {
      console.error('[U1 Extension]', err);
      setConvertButtonState(btn, 'error');
      await new Promise(r => setTimeout(r, 2500));
    } finally {
      isConverting       = false;
      _bypassInterceptor = false;
      setConvertButtonState(btn, 'ready');
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
    if (!item) throw new Error('Download 3MF option not found — select a print profile first');
    console.log('[U1 Extension] clicking:', item.textContent.trim().slice(0, 40));
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function findVisibleDownloadItem() {
    // Match English + German MakerWorld labels:
    // "Download 3MF" / "3MF herunterladen"
    const normalize = t => (t || '').trim().replace(/\s+/g, ' ');
    const isDownload3mf = t => {
      t = normalize(t);
      return (
        /^download\s+3mf/i.test(t) ||
        /^3mf\s+herunterladen/i.test(t)
      ) && t.length < 60;
    };

    for (const el of document.querySelectorAll('li, button, a, div, span, [role="menuitem"], [role="option"]')) {
      if (!isVisible(el)) continue;
      if (isDownload3mf(el.textContent)) return el;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!isDownload3mf(node.textContent)) continue;
      const p = node.parentElement;
      if (p && isVisible(p)) return p;
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
    const wrapper = findSwiper();
    if (wrapper) injectU1Slide(wrapper);
    if (u1ModeActive) updateButton();
  }).observe(document.body, { childList: true, subtree: true });

  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (isInjecting || location.pathname === lastPath) return;
    lastPath      = location.pathname;
    injectedSlide = null;
    setU1Mode(false);
    setTimeout(() => { const w = findSwiper(); if (w) injectU1Slide(w); }, 800);
  }).observe(document.body, { childList: true, subtree: true });
})();
