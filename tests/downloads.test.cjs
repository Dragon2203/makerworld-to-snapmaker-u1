const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Execute the production shared workflow with browser API stubs.
const source = readFileSync(join(__dirname, '../content.js'), 'utf8');
const outputSource = readFileSync(join(__dirname, '../u1_output_download.js'), 'utf8');
const optionsSource = readFileSync(join(__dirname, '../options.js'), 'utf8');

const settingsSource = readFileSync(join(__dirname, '../u1_download_settings.js'), 'utf8');
const resolveMethod = vm.runInNewContext(`${settingsSource}; resolveU1DownloadMethod`);

function createDownload({ firefox = false, method = 'chrome-api', runtimeError, clickError, responses = [] } = {}) {
  const messages = [];
  const clicks = [];
  const bytes = new Uint8Array([0, 80, 75, 3, 4, 255]);
  const converted = bytes.subarray(1, 5);
  const context = {
    isFirefox: firefox,
    currentSettings: { downloadMethod: method },
    downloadMethod: method,
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
        callback(responses.length ? responses.shift() : { ok: true, downloadId: 42, filenameForced: method === 'chrome-api-force' });
      },
    } },
    browser: { runtime: { async sendMessage(message) {
      messages.push(message);
      if (runtimeError) throw new Error(runtimeError);
      return responses.length ? responses.shift() : { ok: true, downloadId: 43 };
    } } },
  };
  return { messages, clicks, converted, context };
}

async function runOutputStage(harness, filename, { local = false, fault = 'none' } = {}) {
  const timers = [];
  const metadata = {};
  const operations = [];
  harness.metadata = metadata;
  harness.operations = operations;
  const context = {
    ...harness.context,
    location: { pathname: '/en/models/123-model' },
    mwName: filename,
    activeTestFault: fault,
    console,
    Uint8Array,
    diagnostics: { setMetadata(values) { Object.assign(metadata, values); }, startStage() {}, setOperation(value) { operations.push(value); }, clearOperation() {} },
    U1_DIAGNOSTIC_STAGES: { START_OUTPUT_DOWNLOAD: 'start-output-download' },
    getU1DiagnosticStageLabel() {},
    throwU1SimulatedFault() {},
    logU1OutputDownloadReportSafe() {},
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
  };
  const ctx = vm.createContext(context);
  vm.runInContext(`${settingsSource}\n${outputSource}`, ctx);
  let run;
  if (local) {
    const start = optionsSource.indexOf('function getLocal3mfOutputFilename(');
    const end = optionsSource.indexOf('function setStatus(', start);
    vm.runInContext(optionsSource.slice(start, end), ctx);
    if (context.isFirefox) context.browser.runtime.getBrowserInfo = () => ({});
    run = vm.runInContext('downloadLocal3mf(converted, mwName, currentSettings, diagnostics).then(result => result.report)', ctx);
  } else {
    const stageStart = source.indexOf('      const slug =', source.indexOf('// 7. Start converted file download'));
    const stageEnd = source.indexOf('      diagnostics.completeStage(', stageStart);
    // The MakerWorld adapter now delegates the entire output stage.
    const adapter = source.slice(stageStart, stageEnd).replace('await downloadU1Output(', 'return await downloadU1Output(');
    run = vm.runInContext(`(async () => { ${adapter} })()`, ctx);
  }
  return { report: await run, timers, metadata, operations };
}

const methods = ['chrome-api', 'chrome-api-force', 'native-html'];

for (const [name, file, defaultsName] of [
  ['content', 'content.js', 'SETTING_DEFAULTS'],
  ['options', 'options.js', 'DEFAULTS'],
]) {
  test(`${name} storage defaults preserve legacy migration and explicit methods`, () => {
    const text = readFileSync(join(__dirname, '..', file), 'utf8');
    const start = text.indexOf(`const ${defaultsName} =`);
    const defaults = vm.runInNewContext(`${text.slice(start, text.indexOf('};', start) + 2)}; ${defaultsName}`, { U1_CUSTOM_PRINTER_STANDARD_ID: 'standard' });
    assert.equal(resolveMethod(defaults), 'chrome-api');
    assert.equal(resolveMethod({ ...defaults, forceDownloadFilename: false }), 'chrome-api');
    assert.equal(resolveMethod({ ...defaults, forceDownloadFilename: true }), 'chrome-api-force');
    for (const method of methods) {
      for (const legacy of [true, false]) {
        assert.equal(resolveMethod({ ...defaults, forceDownloadFilename: legacy, downloadMethod: method }), method);
      }
    }
  });
}

for (const method of methods) {
  test(`${method}: selects transport and reports the available receipt`, async () => {
    const harness = createDownload({ method });
    const { report, metadata, operations } = await runOutputStage(harness, '小樱 🪄.3mf');
    const native = method === 'native-html';
    assert.equal(harness.messages.length, native ? 0 : 1);
    assert.equal(harness.clicks.length, native ? 1 : 0);
    if (native) {
      assert.deepEqual(harness.clicks[0], { href: 'blob:https://makerworld.com/converted', download: '小樱 🪄-U1.3mf' });
    } else {
      assert.equal(harness.messages[0].type, 'u1_download');
      assert.equal(harness.messages[0].forceFilename, method === 'chrome-api-force');
    }
    assert.equal(report.configuredDownloadMethod, method);
    assert.equal(report.downloadMethod, method);
    assert.equal(report.status, native ? 'initiated' : 'accepted');
    assert.equal(report.success, native ? null : true);
    assert.equal(report.filenameForced, method === 'chrome-api-force');
    assert.equal(report.attempts[0].downloadId, native ? null : 42);
    assert.equal(report.attempts[0].downloadMethod, method);
    assert.equal(metadata.outputDownloadMethod, method);
    assert.equal(metadata.outputDownloadStatus, report.status);
    assert.equal(operations[0].downloadMethod, method);

    const logs = [];
    const consoleStub = { groupCollapsed() {}, groupEnd() {}, log(...values) { logs.push(values); } };
    const reportSource = readFileSync(join(__dirname, '../u1_project_report.js'), 'utf8');
    const reportContext = vm.createContext({ console: consoleStub, report });
    vm.runInContext(reportSource, reportContext);
    vm.runInContext('logU1OutputDownloadReport(report)', reportContext);
    const summary = logs.find(([label]) => label === 'summary:')[1];
    assert.equal(summary.downloadMethod, method);
    assert.equal(summary.configuredDownloadMethod, method);
    assert.equal(summary.success, native ? null : true);
    assert.equal(summary.status, report.status);
    assert.equal(logs.find(([label]) => label === 'attempts:')[1].length, 1);
    assert.equal(vm.runInContext('formatConverterOptionsForReport({downloadMethod: report.configuredDownloadMethod}).downloadMethod', reportContext), method);
  });

  test(`${method}: errors retain method, attempted name and failure diagnostics`, async () => {
    const native = method === 'native-html';
    const harness = createDownload({ method, clickError: native ? 'Click failed' : undefined, responses: [{ ok: false, error: 'Download failed' }] });
    await assert.rejects(runOutputStage(harness, 'model.3mf'), error => {
      assert.equal(error.u1DiagnosticContext.downloadMethod, method);
      assert.equal(error.u1DiagnosticContext.configuredDownloadMethod, method);
      assert.equal(error.u1DiagnosticContext.downloadStatus, 'failed');
      assert.equal(error.u1DiagnosticContext.failedAttempt, 'original');
      assert.equal(error.u1DiagnosticContext.downloadAttempts[0].downloadMethod, method);
      assert.equal(harness.metadata.outputDownloadStatus, 'failed');
      // Render through the real diagnostic normalizer and error report.
      const ctx = vm.createContext({ console, Error, performance, error, metadata: harness.metadata });
      vm.runInContext(readFileSync(join(__dirname, '../converter.js'), 'utf8'), ctx);
      vm.runInContext(readFileSync(join(__dirname, '../u1_error_report.js'), 'utf8'), ctx);
      const rendered = vm.runInContext(`buildU1ErrorReportObject(prepareU1ErrorForReport(error, {
        ...getU1StageErrorDefaults(U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD),
        stage: U1_DIAGNOSTIC_STAGES.START_OUTPUT_DOWNLOAD,
      }))`, ctx);
      assert.equal(rendered.summary.code, 'U1-DL-005');
      assert.equal(rendered.filenameHandling.downloadMethod, method);
      assert.equal(rendered.filenameHandling.downloadStatus, 'failed');
      assert.equal(rendered.filenameHandling.attempts.length, 1);
      return true;
    });
  });

  test(`Firefox ignores ${method} and retains its binary message transport`, async () => {
    const harness = createDownload({ firefox: true, method });
    const { report } = await runOutputStage(harness, 'model.3mf');
    assert.equal(harness.messages[0].type, 'u1_download_firefox');
    assert.deepEqual(new Uint8Array(harness.messages[0].data), harness.converted);
    assert.equal(harness.clicks.length, 0);
    assert.equal(report.downloadMethod, 'firefox');
    assert.equal(report.configuredDownloadMethod, method);
    assert.equal(report.forceFilename, false);
    assert.equal(report.filenameForced, false);
    assert.equal(report.status, 'accepted');
  });
}

for (const method of ['chrome-api', 'chrome-api-force']) {
  test(`${method}: invalid filenames retry the normalized name through the same API`, async () => {
    const harness = createDownload({ method, responses: [{ ok: false, error: 'Invalid filename' }] });
    const { report } = await runOutputStage(harness, '小樱:🪄.3mf');
    assert.deepEqual(harness.messages.map(m => m.filename), ['小樱:🪄-U1.3mf', '小樱_🪄-U1.3mf']);
    assert.equal(report.finalFilename, '小樱_🪄-U1.3mf');
    assert.equal(report.fallbackUsed, true);
    assert.equal(report.status, 'accepted');
    assert.equal(report.attempts.length, 2);
    assert.ok(report.attempts.every(a => a.downloadMethod === method));
  });

  test(`${method}: failed normalized fallback retains both errors`, async () => {
    const harness = createDownload({ method, responses: [{ ok: false, error: 'Invalid filename' }, { ok: false, error: 'Download denied' }] });
    await assert.rejects(runOutputStage(harness, 'model:name.3mf'), error => {
      assert.equal(error.message, 'Download denied');
      assert.equal(error.u1DiagnosticContext.failedAttempt, 'normalized-fallback');
      assert.equal(error.u1DiagnosticContext.downloadAttempts.length, 2);
      assert.equal(error.u1DiagnosticContext.downloadMethod, method);
      assert.equal(error.u1DiagnosticContext.downloadStatus, 'failed');
      return true;
    });
  });

  test(`${method}: messaging errors reach the existing error handler`, async () => {
    const harness = createDownload({ method, runtimeError: 'Extension context invalidated' });
    await assert.rejects(runOutputStage(harness, 'model.3mf'), /Extension context invalidated/);
    assert.equal(harness.metadata.outputDownloadStatus, 'failed');
  });
}

test('native downloads normalize names once without claiming filename forcing or API acceptance', async () => {
  const harness = createDownload({ method: 'native-html' });
  const { report, timers } = await runOutputStage(harness, '小樱:🪄.3mf');
  assert.equal(harness.clicks[0].download, '小樱_🪄-U1.3mf');
  assert.equal(report.finalFilename, harness.clicks[0].download);
  assert.equal(report.fallbackUsed, true);
  assert.equal(report.attempts.length, 1);
  assert.equal(report.attempts[0].type, 'normalized-fallback');
  assert.equal(report.filenameForced, false);
  assert.equal(report.success, null);
  assert.equal(timers[0].delay, 60_000);
});

test('native click failures do not retry the same normalized name', async () => {
  const harness = createDownload({ method: 'native-html', clickError: 'Invalid filename' });
  await assert.rejects(runOutputStage(harness, 'model:name.3mf'), error => {
    assert.equal(error.message, 'Invalid filename');
    assert.equal(error.u1DiagnosticContext.failedAttempt, 'normalized-fallback');
    assert.equal(error.u1DiagnosticContext.downloadAttempts.length, 1);
    return true;
  });
});

test('forced API fallback reports the actual standard transport', async () => {
  const harness = createDownload({ method: 'chrome-api-force', responses: [{ ok: true, downloadId: 42, downloadMethod: 'chrome-api', filenameForced: false }] });
  const { report, metadata } = await runOutputStage(harness, 'model.3mf');
  assert.equal(report.configuredDownloadMethod, 'chrome-api-force');
  assert.equal(report.downloadMethod, 'chrome-api');
  assert.equal(report.attempts[0].downloadMethod, 'chrome-api');
  assert.equal(report.filenameForced, false);
  assert.equal(metadata.outputDownloadMethod, 'chrome-api');
});

test('Firefox messaging errors retain Firefox transport diagnostics', async () => {
  const harness = createDownload({ firefox: true, method: 'native-html', runtimeError: 'Firefox message failed' });
  await assert.rejects(runOutputStage(harness, 'model.3mf'), error => {
    assert.equal(error.u1DiagnosticContext.downloadMethod, 'firefox');
    assert.equal(error.u1DiagnosticContext.configuredDownloadMethod, 'native-html');
    return true;
  });
});

test('settings UI migrates, explains and saves each method, including Firefox preferences', async () => {
  const options = readFileSync(join(__dirname, '../options.js'), 'utf8');
  const hint = options.slice(options.indexOf('function updateDownloadMethodHint()'), options.indexOf('// ── Save settings'));
  const save = options.slice(options.indexOf("document.getElementById('saveBtn').addEventListener"), options.indexOf('// ── Init'));
  const loadStart = options.indexOf('  const downloadMethodSelect =');
  const load = options.slice(loadStart, options.indexOf("  document.getElementById('debugReport')", loadStart));
  for (const firefox of [false, true]) {
    let onSave;
    let onChange;
    let stored;
    const elements = {
      downloadMethod: { addEventListener(event, fn) { onChange = fn; } },
      downloadMethodHint: {},
      saveBtn: { addEventListener(event, fn) { onSave = fn; } },
    };
    const ctx = vm.createContext({
      document: { getElementById(id) { return elements[id]; } },
      chrome: { runtime: { getURL: () => firefox ? 'moz-extension://u1/' : 'chrome-extension://u1/' } },
      s: { forceDownloadFilename: true },
      U1_CUSTOM_PRINTER_STANDARD_ID: 'standard', ENABLE_U1_FAULT_SIMULATION: false,
      async setSyncStorage(value) { stored = value; }, setStatus() {},
    });
    vm.runInContext(`${settingsSource}\n${hint}\n${save}\n${load}`, ctx);
    assert.equal(elements.downloadMethod.value, 'chrome-api-force');
    assert.equal(elements.downloadMethod.disabled, firefox);
    for (const method of methods) {
      elements.downloadMethod.value = method;
      onChange();
      assert.ok(elements.downloadMethodHint.textContent.length > 30);
      if (firefox) assert.match(elements.downloadMethodHint.textContent, /Firefox/);
      await onSave();
      assert.equal(stored.downloadMethod, method);
      assert.equal(stored.forceDownloadFilename, method === 'chrome-api-force');
    }
  }
});

test('both browser packages and the options page load the shared settings resolver before use', () => {
  for (const name of ['manifest.json', 'manifest.firefox.json']) {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', name), 'utf8'));
    const scripts = manifest.content_scripts[0].js;
    assert.ok(scripts.indexOf('u1_output_download.js') >= 0);
    assert.ok(scripts.indexOf('u1_output_download.js') < scripts.indexOf('content.js'));
    assert.ok(scripts.indexOf('u1_download_settings.js') >= 0);
    assert.ok(scripts.indexOf('u1_download_settings.js') < scripts.indexOf('content.js'));
  }
  const html = readFileSync(join(__dirname, '../options.html'), 'utf8');
  assert.ok(html.indexOf('src="u1_download_settings.js"') < html.indexOf('src="options.js"'));
  const build = readFileSync(join(__dirname, '../build.ps1'), 'utf8');
  assert.equal(build.match(/'u1_download_settings.js'/g).length, 2);
  assert.equal(build.match(/'u1_output_download.js'/g).length, 2);
  assert.ok(html.indexOf('src="u1_output_download.js"') < html.indexOf('src="options.js"'));
});

for (const method of methods) {
  test(`local ${method}: shared transport, naming and copy-ready report`, async () => {
    const harness = createDownload({ method });
    const { report, timers } = await runOutputStage(harness, '本地:测试.3mf', { local: true });
    assert.equal(report.finalFilename, '本地_测试-U1.3mf');
    assert.equal(report.downloadMethod, method);
    assert.equal(report.status, method === 'native-html' ? 'initiated' : 'accepted');
    assert.equal(report.filenameForced, method === 'chrome-api-force');
    assert.equal(harness.clicks.length, method === 'native-html' ? 1 : 0);
    assert.equal(harness.messages.length, method === 'native-html' ? 0 : 1);
    if (method !== 'native-html') assert.equal(harness.messages[0].forceFilename, method === 'chrome-api-force');
    assert.equal(timers[0].delay, 60_000);
    const ctx = vm.createContext({ report });
    vm.runInContext(readFileSync(join(__dirname, '../u1_project_report.js'), 'utf8'), ctx);
    const text = vm.runInContext('buildU1OutputDownloadReportText(report)', ctx);
    assert.ok(text.includes(`Configured method: ${method}`));
    assert.ok(text.includes(`Actual transport: ${method}`));
    assert.ok(text.includes(`Status: ${report.status}`));
    assert.ok(text.includes('completion is not confirmed'));
  });

  test(`local ${method}: failures keep diagnostic method and operation`, async () => {
    const harness = createDownload({ method, clickError: 'Click denied', responses: [{ ok: false, error: 'Download denied' }] });
    await assert.rejects(runOutputStage(harness, 'model.3mf', { local: true }), error => {
      assert.equal(error.u1DiagnosticContext.downloadMethod, method);
      assert.equal(error.u1DiagnosticContext.downloadStatus, 'failed');
      assert.equal(harness.operations.at(-1).downloadMethod, method);
      assert.equal(harness.operations.at(-1).originalFilename, 'model-U1.3mf');
      return true;
    });
  });

  test(`local Firefox ignores ${method} and preserves callback binary messages`, async () => {
    const harness = createDownload({ firefox: true, method });
    // Local Firefox uses chrome.runtime's callback API, as in v1.8.0.
    harness.context.browser.runtime.sendMessage = () => assert.fail('Local Firefox must keep the callback path');
    harness.context.chrome.runtime.sendMessage = (message, callback) => {
      harness.messages.push(message);
      callback({ ok: true, downloadId: 43 });
    };
    const { report } = await runOutputStage(harness, 'model.3mf', { local: true });
    assert.equal(harness.messages[0].type, 'u1_download_firefox');
    assert.deepEqual(new Uint8Array(harness.messages[0].data), harness.converted);
    assert.equal(report.configuredDownloadMethod, method);
    assert.equal(report.downloadMethod, 'firefox');
    assert.equal(report.filenameForced, false);
    assert.equal(harness.clicks.length, 0);
  });
}

for (const local of [false, true]) {
  for (const method of ['chrome-api', 'chrome-api-force']) {
    test(`${local ? 'local' : 'MakerWorld'} ${method}: failed normalized retry has method in the final operation`, async () => {
      const harness = createDownload({ method, responses: [
        { ok: false, error: 'Invalid filename' },
        { ok: false, error: 'Retry denied', downloadMethod: 'chrome-api' },
      ] });
      await assert.rejects(runOutputStage(harness, 'emoji\u200dname.3mf', { local }), error => {
        const operation = harness.operations.at(-1);
        assert.equal(operation.configuredDownloadMethod, method);
        assert.equal(operation.downloadMethod, 'chrome-api');
        assert.equal(operation.downloadStatus, 'failed');
        assert.equal(operation.downloadAttemptType, 'normalized-fallback');
        assert.equal(error.u1DiagnosticContext.downloadAttempts.length, 2);
        assert.equal(error.u1DiagnosticContext.downloadMethod, 'chrome-api');
        return true;
      });
    });
  }
}

test('local saved settings resolve migration before conversion and project reporting', async () => {
  const start = optionsSource.indexOf('async function getLocal3mfConverterOptions(');
  const end = optionsSource.indexOf('// ── Local 3MF download', start);
  for (const saved of [{ forceDownloadFilename: true }, { forceDownloadFilename: false }, { forceDownloadFilename: true, downloadMethod: 'native-html' }]) {
    const ctx = vm.createContext({ DEFAULTS: {}, U1_CUSTOM_PRINTER_STANDARD_ID: 'standard', getSyncStorage: async () => ({ ...saved }) });
    vm.runInContext(`${settingsSource}\n${optionsSource.slice(start, end)}`, ctx);
    const settings = await vm.runInContext('getLocal3mfConverterOptions()', ctx);
    assert.equal(settings.downloadMethod, resolveMethod(saved));
    assert.equal(settings.forceDownloadFilename, settings.downloadMethod === 'chrome-api-force');
  }
});

test('local conversion lifecycle retains reports, error codes and UI cleanup', async () => {
  for (const failure of [false, true]) {
    const harness = createDownload({ method: 'native-html', clickError: failure ? 'Click denied' : undefined });
    const elements = {};
    const element = id => elements[id] ||= { hidden: true, classList: { toggle() {} } };
    const ctx = vm.createContext({
      ...harness.context, Uint8Array, ArrayBuffer, Error, performance, structuredClone,
      console: { info() {}, warn() {}, error() {}, log() {}, groupCollapsed() {}, groupEnd() {} },
      document: { ...harness.context.document, getElementById: element },
      setTimeout() {}, U1_CUSTOM_PRINTER_STANDARD_ID: 'standard',
      getConverterVersion: () => '1.8.0',
    });
    for (const file of ['converter.js', 'u1_project_report.js', 'u1_error_report.js']) {
      vm.runInContext(readFileSync(join(__dirname, '..', file), 'utf8'), ctx);
    }
    vm.runInContext(`${settingsSource}\n${outputSource}`, ctx);
    const localUi = optionsSource.slice(optionsSource.indexOf('const local3mfDropZone ='), optionsSource.indexOf('// ── Copy local 3MF report'));
    const download = optionsSource.slice(optionsSource.indexOf('function getLocal3mfOutputFilename('), optionsSource.indexOf('function setStatus('));
    vm.runInContext(`${localUi}\n${download}`, ctx);
    ctx.getLocal3mfConverterOptions = async () => ({ downloadMethod: 'native-html' });
    ctx.convertToU1 = async (bytes, options) => { options.onProjectReport({}); return harness.converted; };
    ctx.buildU1ProjectReportText = () => 'Project conversion report';
    ctx.file = { name: 'local.3mf', size: 4, async arrayBuffer() { return new ArrayBuffer(4); } };
    await vm.runInContext('handleLocal3mfFile(file)', ctx);
    assert.equal(element('local3mfChooseBtn').disabled, false);
    const text = vm.runInContext('local3mfReportText', ctx);
    if (failure) {
      assert.equal(element('local3mfCopyReportBtn').textContent, 'Copy Error Report');
      assert.match(text, /U1-DL-005/);
      assert.match(text, /native-html/);
      assert.match(element('local3mfStatus').textContent, /Download failed/);
    } else {
      assert.equal(element('local3mfCopyReportBtn').textContent, 'Copy Project Report');
      assert.match(text, /Project conversion report/);
      assert.match(text, /Actual transport: native-html/);
      assert.match(text, /Status: initiated/);
      assert.match(element('local3mfStatus').textContent, /Download requested/);
    }
  }
});
