// Runs in MAIN world — wraps window.fetch to intercept MakerWorld's own
// authenticated f3mf download requests so we inherit auth for free.

console.log('[U1 injected] loaded');

window.__u1ModeActive = false;
window.__u1Capturing  = false;

const _baseFetch = window.fetch;
window.fetch = function (url, opts) {
  const p = _baseFetch.apply(this, arguments);
  if (typeof url === 'string' && url.includes('f3mf') && window.__u1Capturing) {
    window.__u1Capturing = false;
    console.log('[U1 injected] intercepted f3mf fetch:', url);
    p.then(async (resp) => {
      console.log('[U1 injected] f3mf status:', resp.status);
      if (!resp.ok) {
        window.dispatchEvent(new CustomEvent('__u1_3mf_err', { detail: resp.status }));
        return;
      }
      // Clone before MakerWorld reads the original body
      const buffer  = await resp.clone().arrayBuffer();
      const blobUrl = URL.createObjectURL(
        new Blob([buffer], { type: 'application/octet-stream' })
      );
      console.log('[U1 injected] dispatching __u1_3mf');
      window.dispatchEvent(new CustomEvent('__u1_3mf', { detail: blobUrl }));
    }).catch((err) => {
      console.error('[U1 injected] capture error:', err);
      window.dispatchEvent(new CustomEvent('__u1_3mf_err', { detail: err.message }));
    });
  }
  return p;
};

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data) return;
  if (e.data.__u1SetMode !== undefined) {
    console.log('[U1 injected] mode set to', e.data.__u1SetMode);
    window.__u1ModeActive = e.data.__u1SetMode;
  }
  if (e.data.__u1StartCapture) {
    console.log('[U1 injected] capture armed');
    window.__u1Capturing = true;
  }
  if (e.data.__u1CancelCapture) {
    window.__u1Capturing = false;
  }
});

// Block any native <a download> clicks while U1 mode is active
document.addEventListener('click', (e) => {
  if (!window.__u1ModeActive) return;
  const a = e.target.closest('a[download]');
  if (a) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
