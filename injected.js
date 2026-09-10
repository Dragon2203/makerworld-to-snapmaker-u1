// Runs in MAIN world — wraps window.fetch to intercept MakerWorld's own
// authenticated f3mf download requests so we inherit auth for free.

console.log('[U1 injected] loaded');

window.__u1ModeActive = false;
window.__u1Capturing  = false;

// Incremented whenever a capture is started or cancelled.
// Async responses from an older capture must never satisfy a newer one.
let u1CaptureGeneration = 0;

const _baseFetch = window.fetch;
window.fetch = function (url, opts) {
  const p = _baseFetch.apply(this, arguments);
  if (typeof url === 'string' && url.includes('f3mf') && window.__u1Capturing) {
    const captureGeneration =
      u1CaptureGeneration;

    window.__u1Capturing = false;

    console.log('[U1 injected] intercepted f3mf fetch:', url);

    p.then(async (resp) => {
      if (
        captureGeneration !==
        u1CaptureGeneration
      ) {
        return;
      }
      console.log('[U1 injected] f3mf status:', resp.status);
      if (!resp.ok) {
        window.dispatchEvent(
          new CustomEvent(
            '__u1_3mf_err',
            {
              detail:
                JSON.stringify({
                  captureTransport:
                    'fetch',

                  errorType:
                    'http',

                  httpStatus:
                    resp.status,

                  responseType:
                    String(
                      resp.type ||
                      'fetch-response'
                    ),

                  requestUrl:
                    String(url || ''),
                }),
            }
          )
        );

        return;
      }
      // Clone before MakerWorld reads the original body
      const buffer  = await resp.clone().arrayBuffer();

      if (
        captureGeneration !==
        u1CaptureGeneration
      ) {
        return;
      }

      const blobUrl = URL.createObjectURL(
        new Blob([buffer], { type: 'application/octet-stream' })
      );
      console.log('[U1 injected] dispatching __u1_3mf');

      window.dispatchEvent(
        new CustomEvent(
          '__u1_3mf',
          {
            detail:
              JSON.stringify({
                blobUrl,

                requestUrl:
                  String(url || ''),

                captureTransport:
                  'fetch',

                httpStatus:
                  resp.status,

                responseType:
                  String(
                    resp.type ||
                    'fetch-response'
                  ),
              }),
          }
        )
      );
    }).catch((err) => {
      if (
        captureGeneration !==
        u1CaptureGeneration
      ) {
        return;
      }

      console.error(
        '[U1 injected] capture error:',
        err
      );

      window.dispatchEvent(
        new CustomEvent(
          '__u1_3mf_err',
          {
            detail:
              JSON.stringify({
                captureTransport:
                  'fetch',

                errorType:
                  'capture',

                requestUrl:
                  String(url || ''),

                message:
                  err instanceof Error
                    ? err.message
                    : String(err),
              }),
          }
        )
      );
    });
  }
  return p;
};

// MakerWorld may use XMLHttpRequest instead of fetch for the authenticated
// /f3mf request. Capture that response as well and pass it through the same
// __u1_3mf event used by the existing fetch interceptor.
//
// Important:
// The /f3mf response is MakerWorld's small JSON response containing the
// filename and signed CDN URL. content.js already parses this response and
// downloads the actual 3MF from the CDN afterwards.
const u1XhrRequestUrls =
  new WeakMap();

const u1OriginalXhrOpen =
  XMLHttpRequest.prototype.open;

const u1OriginalXhrSend =
  XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open =
  function (
    method,
    url
  ) {
    const result =
      u1OriginalXhrOpen.apply(
        this,
        arguments
      );

    u1XhrRequestUrls.set(
      this,
      String(url || '')
    );

    return result;
  };

XMLHttpRequest.prototype.send =
  function () {
    const requestUrl =
      u1XhrRequestUrls.get(this) || '';

    // Leave every unrelated XHR completely untouched.
    if (
      !window.__u1Capturing ||
      !requestUrl.includes('f3mf')
    ) {
      return u1OriginalXhrSend.apply(
        this,
        arguments
      );
    }

    const captureGeneration =
      u1CaptureGeneration;

    const onLoadEnd =
      async () => {
        // The conversion may have timed out/cancelled while this request
        // was running, or a newer capture may already have started.
        if (
          !window.__u1Capturing ||
          captureGeneration !==
            u1CaptureGeneration
        ) {
          return;
        }

        // Claim this response so another matching request cannot satisfy
        // the same conversion.
        window.__u1Capturing =
          false;

        if (
          this.status < 200 ||
          this.status >= 300
        ) {
          
          window.dispatchEvent(
            new CustomEvent(
              '__u1_3mf_err',
              {
                detail:
                  JSON.stringify({
                    captureTransport:
                      'XMLHttpRequest',

                    errorType:
                      'http',

                    httpStatus:
                      this.status,

                    responseType:
                      String(
                        this.responseType ||
                          'text'
                      ),

                    requestUrl:
                      String(
                        requestUrl ||
                          ''
                      ),
                  }),
              }
            )
          );

          return;
        }

        try {
          let buffer;

          if (
            this.responseType ===
            'blob'
          ) {
            buffer =
              await this.response.arrayBuffer();
          } else if (
            this.responseType ===
            'arraybuffer'
          ) {
            buffer =
              this.response;
          } else if (
            this.responseType ===
            'json'
          ) {
            buffer =
              JSON.stringify(
                this.response
              );
          } else {
            buffer =
              this.responseText;
          }

          // Blob conversion above is asynchronous. A cancellation or a
          // newer capture may have happened while we were awaiting it.
          if (
            captureGeneration !==
              u1CaptureGeneration
          ) {
            return;
          }

          const blobUrl =
            URL.createObjectURL(
              new Blob(
                [buffer],
                {
                  type:
                    'application/octet-stream',
                }
              )
            );

          console.groupCollapsed(
            '[U1 Download Capture] XMLHttpRequest · ' +
            `${this.status} · captured`
          );

          console.log(
            'Request URL:',
            requestUrl
          );

          console.log(
            'Transport:',
            'XMLHttpRequest'
          );

          console.log(
            'HTTP status:',
            this.status
          );

          console.log(
            'Response type:',
            this.responseType ||
              'text'
          );

          console.log(
            'Result:',
            'dispatched __u1_3mf'
          );

          console.groupEnd();

          window.dispatchEvent(
            new CustomEvent(
              '__u1_3mf',
              {
                detail:
                  JSON.stringify({
                    blobUrl,

                    requestUrl:
                      String(
                        requestUrl ||
                          ''
                      ),

                    captureTransport:
                      'XMLHttpRequest',

                    httpStatus:
                      this.status,

                    responseType:
                      String(
                        this.responseType ||
                          'text'
                      ),
                  }),
              }
            )
          );
        } catch (err) {
          if (
            captureGeneration !==
              u1CaptureGeneration
          ) {
            return;
          }

          console.error(
            '[U1 injected] XHR capture error:',
            err
          );

          window.dispatchEvent(
            new CustomEvent(
              '__u1_3mf_err',
              {
                detail:
                  JSON.stringify({
                    captureTransport:
                      'XMLHttpRequest',

                    errorType:
                      'capture',

                    httpStatus:
                      this.status,

                    responseType:
                      String(
                        this.responseType ||
                          'text'
                      ),

                    requestUrl:
                      String(
                        requestUrl ||
                          ''
                      ),

                    message:
                      err instanceof Error
                        ? err.message
                        : String(err),
                  }),
              }
            )
          );
        }
      };

    this.addEventListener(
      'loadend',
      onLoadEnd,
      {
        once:
          true,
      }
    );

    try {
      return u1OriginalXhrSend.apply(
        this,
        arguments
      );
    } catch (err) {
      this.removeEventListener(
        'loadend',
        onLoadEnd
      );

      throw err;
    }
  };

const U1_WINDOW_MESSAGE_SOURCE =
  'makerworld-to-snapmaker-u1';

function sendU1MainWorldReady() {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'main-world-ready',
    },
    '*'
  );
}

function sendU1PrinterSwiperRepairResult(
  wrapperId,
  result,
  details = {}
) {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'printer-swiper-repair-result',

      wrapperId:
        String(wrapperId || ''),

      result:
        String(result || 'unknown'),

      details: {
        swiperFound:
          details.swiperFound === true,

        slideToAvailable:
          details.slideToAvailable === true,

        navigationUpdated:
          details.navigationUpdated === true,

        message:
          String(details.message || ''),
      },
    },
    '*'
  );
}

function sendU1PrinterSwiperRefreshResult(
  wrapperId,
  result,
  details = {}
) {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'printer-swiper-refresh-result',

      wrapperId:
        String(wrapperId || ''),

      result:
        String(result || 'unknown'),

      details: {
        swiperFound:
          details.swiperFound === true,

        navigationFound:
          details.navigationFound === true,

        navigationUpdated:
          details.navigationUpdated === true,

        message:
          String(details.message || ''),
      },
    },
    '*'
  );
}

function refreshU1PrinterSwiper(
  wrapperId
) {
  const normalizedId =
    String(wrapperId || '');

  // Only accept the short internal identifiers generated by content.js.
  // Never accept arbitrary selectors or executable values from page messages.
  if (
    !/^u1-[a-z0-9-]{1,80}$/i.test(
      normalizedId
    )
  ) {
    return;
  }

  const wrapper =
    Array.from(
      document.querySelectorAll(
        '[data-u1-refresh-id]'
      )
    ).find(
      candidate =>
        candidate.dataset.u1RefreshId ===
        normalizedId
    );

  if (!wrapper) {
    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'wrapper-not-found'
    );

    return;
  }

  const swiperElement =
    wrapper.closest('.swiper');

  const swiper =
    swiperElement?.swiper;

  if (
    !swiper ||
    typeof swiper.update !== 'function'
  ) {
    // Some MakerWorld/Swiper versions may not expose the Swiper instance
    // directly on the DOM element. Request MakerWorld's responsive layout
    // recalculation as a safe fallback.
    window.dispatchEvent(
      new Event('resize')
    );

    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'resize-fallback-dispatched',
      {
        swiperFound:
          false,
      }
    );

    return;
  }

  let navigationFound =
    false;

  let navigationUpdated =
    false;

  function updateSwiper() {
    swiper.update();

    if (
      typeof swiper.updateSlides ===
      'function'
    ) {
      swiper.updateSlides();
    }

    if (
      typeof swiper.updateSlidesClasses ===
      'function'
    ) {
      swiper.updateSlidesClasses();
    }

    navigationFound =
      Boolean(swiper.navigation);

    if (
      typeof swiper.navigation?.update ===
      'function'
    ) {
      swiper.navigation.update();

      navigationUpdated =
        true;
    }
  }

  try {
    // Update immediately so the new U1 slide becomes part of Swiper's
    // internal slide collection.
    updateSwiper();

    // Update once more after the browser has processed the changed layout.
    // This is especially important when the U1 slide creates the first
    // horizontal overflow in an otherwise completely visible printer list.
    requestAnimationFrame(
      () => {
        try {
          updateSwiper();

          sendU1PrinterSwiperRefreshResult(
            normalizedId,
            'updated',
            {
              swiperFound:
                true,

              navigationFound,
              navigationUpdated,
            }
          );
        } catch (error) {
          console.warn(
            '[U1 injected] Delayed printer Swiper refresh failed:',
            error
          );

          sendU1PrinterSwiperRefreshResult(
            normalizedId,
            'update-failed',
            {
              swiperFound:
                true,

              navigationFound,
              navigationUpdated,

              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            }
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      '[U1 injected] Printer Swiper refresh failed:',
      error
    );

    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'update-failed',
      {
        swiperFound:
          true,

        navigationFound,
        navigationUpdated,

        message:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );
  }
}

function repairU1PrinterSwiperVisibility(
  wrapperId
) {
  const normalizedId =
    String(wrapperId || '');

  if (
    !/^u1-[a-z0-9-]{1,80}$/i.test(
      normalizedId
    )
  ) {
    return;
  }

  const wrapper =
    Array.from(
      document.querySelectorAll(
        '[data-u1-repair-id]'
      )
    ).find(
      candidate =>
        candidate.dataset.u1RepairId ===
        normalizedId
    );

  if (!wrapper) {
    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'wrapper-not-found'
    );

    return;
  }

  const swiperElement =
    wrapper.closest('.swiper');

  const swiper =
    swiperElement?.swiper;

  if (
    !swiper ||
    typeof swiper.update !== 'function'
  ) {
    window.dispatchEvent(
      new Event('resize')
    );

    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'resize-fallback-dispatched',
      {
        swiperFound:
          false,

        slideToAvailable:
          false,
      }
    );

    return;
  }

  const slideToAvailable =
    typeof swiper.slideTo ===
    'function';

  let navigationUpdated =
    false;

  function updateNavigation() {
    if (
      typeof swiper.navigation?.update ===
      'function'
    ) {
      swiper.navigation.update();

      navigationUpdated =
        true;
    }
  }

  function performRepair() {
    swiper.update();

    if (
      typeof swiper.updateSlides ===
      'function'
    ) {
      swiper.updateSlides();
    }

    if (slideToAvailable) {
      // The U1 option is inserted directly after MakerWorld's first filter.
      // Move to the logical start only after content.js has confirmed that the
      // option exists but is outside the visible Swiper viewport.
      swiper.slideTo(
        0,
        0,
        false
      );
    }

    swiper.update();

    if (
      typeof swiper.updateSlidesClasses ===
      'function'
    ) {
      swiper.updateSlidesClasses();
    }

    updateNavigation();
  }

  try {
    performRepair();

    requestAnimationFrame(
      () => {
        try {
          performRepair();

          sendU1PrinterSwiperRepairResult(
            normalizedId,
            slideToAvailable
              ? 'repaired-to-start'
              : 'updated-without-slide-to',
            {
              swiperFound:
                true,

              slideToAvailable,
              navigationUpdated,
            }
          );
        } catch (error) {
          console.warn(
            '[U1 injected] Delayed printer Swiper visibility repair failed:',
            error
          );

          sendU1PrinterSwiperRepairResult(
            normalizedId,
            'repair-failed',
            {
              swiperFound:
                true,

              slideToAvailable,
              navigationUpdated,

              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            }
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      '[U1 injected] Printer Swiper visibility repair failed:',
      error
    );

    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'repair-failed',
      {
        swiperFound:
          true,

        slideToAvailable,
        navigationUpdated,

        message:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );
  }
}

window.addEventListener('message', (e) => {
  if (
    e.source !== window ||
    !e.data
  ) {
    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'main-world-status-request'
  ) {
    sendU1MainWorldReady();

    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'refresh-printer-swiper'
  ) {
    refreshU1PrinterSwiper(
      e.data.wrapperId
    );

    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'repair-printer-swiper-visibility'
  ) {
    repairU1PrinterSwiperVisibility(
      e.data.wrapperId
    );

    return;
  }

  if (
    e.data.__u1SetMode !== undefined
  ) {
    console.log(
      '[U1 injected] mode set to',
      e.data.__u1SetMode
    );

    window.__u1ModeActive =
      e.data.__u1SetMode;
  }

  if (e.data.__u1StartCapture) {
    console.log(
      '[U1 injected] capture armed'
    );

    u1CaptureGeneration +=
      1;

    window.__u1Capturing =
      true;
  }

  if (e.data.__u1CancelCapture) {
    u1CaptureGeneration +=
      1;

    window.__u1Capturing =
      false;
  }
});

// Notify content.js after the Main World message listener is fully ready.
//
// content.js also actively requests this status, so the handshake works
// regardless of which script finishes loading first.
sendU1MainWorldReady();

// Block any native <a download> clicks while U1 mode is active
document.addEventListener('click', (e) => {
  if (!window.__u1ModeActive) return;
  const a = e.target.closest('a[download]');
  if (a) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
