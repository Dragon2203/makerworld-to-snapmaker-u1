const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the actual output transport setup without running MakerWorld's UI.
// content.js is a browser script, so keep its closure and production globals intact.
const source = readFileSync(join(__dirname, '../content.js'), 'utf8');
const setup = source.slice(
  source.indexOf('      let releaseOutputUrl ='),
  source.indexOf('      async function runOutputDownloadAttempt(')
);
assert.ok(setup.includes('attemptOutputDownload'));

function createDownload({ firefox = false, forceFilename = false, runtimeError, clickError } = {}) {
  const messages = [];
  const clicks = [];
  const bytes = new Uint8Array([0, 80, 75, 3, 4, 255]);
  const converted = bytes.subarray(1, 5);
  const context = {
    isFirefox: firefox,
    currentSettings: { forceDownloadFilename: forceFilename },
    converted,
    Blob,
    Error,
    URL: { createObjectURL: () => 'blob:https://makerworld.com/converted' },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a');
        return { click() {
          if (clickError) throw new Error(clickError);
          clicks.push({ href: this.href, download: this.download });
        } };
      },
      // The injected script cancels connected download links while U1 mode is on.
      body: { appendChild() { assert.fail('Converted link must stay detached'); } },
    },
    chrome: { runtime: {
      lastError: runtimeError ? { message: runtimeError } : undefined,
      sendMessage(message, callback) {
        messages.push(message);
        callback({ ok: true, downloadId: 42, filenameForced: false });
      },
    } },
    browser: { runtime: { async sendMessage(message) {
      messages.push(message);
      return { ok: true, downloadId: 43 };
    } } },
  };
  const download = vm.runInNewContext(`(() => { ${setup}; return attemptOutputDownload; })()`, context);
  return { download, messages, clicks, converted, context };
}

async function runOutputStage(harness, filename) {
  const timers = [];
  const context = {
    ...harness.context,
    location: { pathname: '/en/models/123-model' },
    mwName: filename,
    activeTestFault: 'none',
    diagnostics: { setMetadata() {}, startStage() {}, setOperation() {}, clearOperation() {} },
    U1_DIAGNOSTIC_STAGES: { START_OUTPUT_DOWNLOAD: 'start-output-download' },
    getU1DiagnosticStageLabel() {},
    throwU1SimulatedFault() {},
    logU1OutputDownloadReportSafe() {},
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
  };
  const helpers = source.slice(source.indexOf('  function isU1InvalidFilenameError('), source.indexOf('  function logU1OutputDownloadReportSafe('));
  const stageStart = source.indexOf('      const slug =', source.indexOf('// 7. Start converted file download'));
  const stageEnd = source.indexOf('      diagnostics.completeStage(', stageStart);
  const run = vm.runInNewContext(`(async () => { ${helpers}\n${source.slice(stageStart, stageEnd)}\nreturn downloadReport; })()`, context);
  return { report: await run, timers };
}

test('Chromium filename compatibility uses a detached native link, without competing extension suggestions', async () => {
  const { download, messages, clicks } = createDownload({ forceFilename: true });
  const result = await download('小樱 🪄-U1.3mf');
  assert.deepEqual(clicks, [{ href: 'blob:https://makerworld.com/converted', download: '小樱 🪄-U1.3mf' }]);
  assert.equal(messages.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.filenameForced, true);
});

test('default Chromium download still uses the background download API', async () => {
  const { download, messages, clicks } = createDownload();
  const result = await download('model-U1.3mf');
  assert.equal(messages[0].type, 'u1_download');
  assert.equal(messages[0].filename, 'model-U1.3mf');
  assert.equal(clicks.length, 0);
  assert.equal(result.downloadId, 42);
});

test('default Chromium messaging errors still reach the download error handler', async () => {
  const { download } = createDownload({ runtimeError: 'Extension context invalidated' });
  await assert.rejects(download('model-U1.3mf'), /Extension context invalidated/);
});

test('Firefox keeps its binary message path and respects the converted byte range', async () => {
  const { download, messages, clicks, converted } = createDownload({ firefox: true, forceFilename: true });
  await download('model-U1.3mf');
  assert.equal(messages[0].type, 'u1_download_firefox');
  assert.deepEqual(new Uint8Array(messages[0].data), converted);
  assert.equal(clicks.length, 0);
});

test('native downloads normalize invalid names once and report the filename actually requested', async () => {
  const harness = createDownload({ forceFilename: true });
  const { report, timers } = await runOutputStage(harness, '小樱:🪄.3mf');
  assert.equal(harness.clicks[0].download, '小樱_🪄-U1.3mf');
  assert.equal(report.finalFilename, harness.clicks[0].download);
  assert.equal(report.fallbackUsed, true);
  assert.equal(report.attempts.length, 1);
  assert.equal(report.attempts[0].type, 'normalized-fallback');
  assert.equal(timers[0].delay, 60_000);
});

test('native click failures report the normalized attempt without retrying the same name', async () => {
  const harness = createDownload({ forceFilename: true, clickError: 'Invalid filename' });
  await assert.rejects(runOutputStage(harness, 'model:name.3mf'), error => {
    assert.equal(error.message, 'Invalid filename');
    assert.equal(error.u1DiagnosticContext.failedAttempt, 'normalized-fallback');
    assert.equal(error.u1DiagnosticContext.downloadAttempts.length, 1);
    return true;
  });
});
