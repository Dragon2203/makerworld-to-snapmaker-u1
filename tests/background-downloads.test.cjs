const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function background({ storageError = false, downloadError = false } = {}) {
  let listener;
  let onMessage;
  const saved = {};
  const suggestions = [];
  const calls = [];
  const runtime = {
    id: 'u1', getURL: () => 'chrome-extension://u1/',
    onMessage: { addListener(fn) { onMessage = fn; } },
  };
  const context = {
    console: { warn() {} },
    chrome: {
      runtime,
      action: { onClicked: { addListener() {} } },
      storage: { session: {
        set(values, cb) {
          Object.assign(saved, values);
          runtime.lastError = storageError ? { message: 'Storage unavailable' } : undefined;
          cb();
          runtime.lastError = undefined;
        },
        get(keys, cb) { cb(saved); },
        remove(key) { delete saved[key]; },
      } },
      downloads: {
        onDeterminingFilename: {
          addListener(fn) { listener = fn; },
          removeListener(fn) { assert.equal(listener, fn); listener = undefined; },
        },
        download(options, cb) {
          // New API calls have their own lastError lifetime.
          runtime.lastError = downloadError ? { message: 'Download failed' } : undefined;
          calls.push(options);
          if (listener && !downloadError) {
            listener({ id: 42, byExtensionId: 'u1', url: options.url }, value => suggestions.push(value));
          }
          cb(downloadError ? undefined : 42);
          runtime.lastError = undefined;
        },
      },
    },
  };
  vm.runInNewContext(readFileSync(join(__dirname, '../background.js'), 'utf8'), context);
  return {
    calls, suggestions, saved,
    get listener() { return listener; },
    send(forceFilename) {
      return new Promise(resolve => onMessage({ type: 'u1_download', url: 'blob:converted', filename: 'model-U1.3mf', forceFilename }, {}, resolve));
    },
  };
}

test('standard API never installs the filename listener', async () => {
  const bg = background();
  assert.equal(bg.listener, undefined);
  const response = await bg.send(false);
  assert.equal(response.ok, true);
  assert.equal(response.downloadMethod, 'chrome-api');
  assert.equal(response.filenameForced, false);
  assert.equal(bg.suggestions.length, 0);
  assert.equal(bg.listener, undefined);
});

test('forced API applies the original suggestion and cleans up before a later standard download', async () => {
  const bg = background();
  const response = await bg.send(true);
  assert.equal(response.ok, true);
  assert.equal(response.downloadMethod, 'chrome-api-force');
  assert.equal(response.filenameForced, true);
  assert.equal(bg.suggestions[0].filename, 'model-U1.3mf');
  assert.equal(bg.suggestions[0].conflictAction, 'uniquify');
  assert.equal(bg.listener, undefined);
  assert.equal(Object.keys(bg.saved).length, 0);
  await bg.send(false);
  assert.equal(bg.suggestions.length, 1);
});

for (const downloadError of [false, true]) {
  test(`forced-state storage failure falls back to standard transport (download error: ${downloadError})`, async () => {
    const bg = background({ storageError: true, downloadError });
    const response = await bg.send(true);
    assert.equal(response.ok, !downloadError);
    assert.equal(response.downloadMethod, 'chrome-api');
    assert.equal(bg.listener, undefined);
    assert.equal(bg.suggestions.length, 0);
    assert.equal(Object.keys(bg.saved).length, 0);
  });
}

for (const force of [false, true]) {
  test(`API errors preserve the transport and clean pending state (force: ${force})`, async () => {
    const bg = background({ downloadError: true });
    const response = await bg.send(force);
    assert.equal(response.ok, false);
    assert.equal(response.error, 'Download failed');
    assert.equal(response.downloadMethod, force ? 'chrome-api-force' : 'chrome-api');
    assert.equal(bg.listener, undefined);
    assert.equal(Object.keys(bg.saved).length, 0);
  });
}
